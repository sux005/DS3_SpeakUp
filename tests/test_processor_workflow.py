"""Unit coverage for processor Lambda actions and replay-safe outcomes."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError, EndpointConnectionError

from src.aws_payload.models import PayloadType, RecordingStatus
from src.aws_payload.keys import artifact_key
from src.aws_payload.errors import WriteConflictError


PROCESSOR_PATH = Path(__file__).resolve().parents[1] / "infra/lambda/processor/index.py"


def load_processor(monkeypatch):
    for key, value in {
        "AWS_DEFAULT_REGION": "us-east-2",
        "AWS_ACCESS_KEY_ID": "test",
        "AWS_SECRET_ACCESS_KEY": "test",
        "ENVIRONMENT": "test",
        "BEDROCK_MODEL_ID": "model-test",
    }.items():
        monkeypatch.setenv(key, value)
    spec = importlib.util.spec_from_file_location("speakup_processor_test", PROCESSOR_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_processor_artifact_versions_follow_deployed_archive(monkeypatch):
    monkeypatch.setenv("PROCESSOR_BUILD_ID", "deployments/processor-a.zip")
    first = load_processor(monkeypatch)
    monkeypatch.setenv("PROCESSOR_BUILD_ID", "deployments/processor-b.zip")
    second = load_processor(monkeypatch)
    assert first.TRANSCRIBE_VERSION != second.TRANSCRIBE_VERSION
    assert first.TRANSCRIPT_VERSION != second.TRANSCRIPT_VERSION
    assert first.FEEDBACK_VERSION != second.FEEDBACK_VERSION


class FakeStore:
    def __init__(self, *, status=RecordingStatus.PROCESSING, transcript=None, feedback_ref=None):
        self.config = SimpleNamespace(data_bucket="bucket", max_transcript_payload_bytes=100_000)
        self.recording = SimpleNamespace(
            user_id="user-1",
            project_id="project-1",
            recording_id="recording-1",
            original_s3_key="users/user-1/projects/project-1/recordings/recording-1/original.wav",
            diagnostic_audio_s3_key=None,
            status=status,
            revision=3,
            execution_arn="arn:execution:test",
            transcription_job_name=None,
            raw_transcript_s3_key=None,
            summary_metrics=(
                {"word_count": 2} if status in (RecordingStatus.ANALYZED, RecordingStatus.COMPLETE)
                else {}
            ),
            payload_refs=(
                {PayloadType.FEEDBACK.value: feedback_ref} if feedback_ref else {}
            ),
        )
        self.transcript = transcript or {"data": {"text": "hello world"}}
        self.stream_bytes = b"{}"
        self.transitions = []
        self.artifacts = []
        self.reconciled = None
        self.missing_artifacts = set()

        self.objects = SimpleNamespace(open_stream=self.open_stream, find_json=self.find_json)

    def find_json(self, *args, **kwargs):
        payload_type = kwargs["payload_type"]
        if payload_type in self.missing_artifacts:
            return None
        reference = self.recording.payload_refs.get(payload_type.value)
        return SimpleNamespace(key=reference["key"]) if reference else None

    def get_recording(self, user_id, recording_id):
        return self.recording

    def transition_recording(self, user_id, recording_id, status, *, expected_revision, updates=None):
        self.transitions.append((status, expected_revision, updates or {}))
        self.recording.status = status
        self.recording.revision += 1
        for key, value in (updates or {}).items():
            setattr(self.recording, key, value)
        return self.recording

    def open_stream(self, reference):
        class Body:
            def __init__(self, value):
                self.value = value

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self, size=-1):
                return self.value[:size]

        return Body(self.stream_bytes)

    def put_json_artifact(self, *args, **kwargs):
        self.artifacts.append(kwargs)
        key = artifact_key(args[0], "project-1", args[1], producer=kwargs["producer"],
                           producer_version=kwargs["producer_version"],
                           artifact_name=kwargs["artifact_name"], content_type="application/json")
        raw = {"key": key, "user_id": args[0], "project_id": "project-1", "recording_id": args[1],
               "payload_type": kwargs["payload_type"].value, "producer": kwargs["producer"],
               "producer_version": kwargs["producer_version"]}
        reference = SimpleNamespace(key=key, as_dict=lambda: raw)
        self.recording.payload_refs[kwargs["payload_type"].value] = raw
        self.recording.revision += 1
        return self.recording, reference

    def reconcile_json_artifact(self, *args, **kwargs):
        return self.reconciled

    def get_json_artifact(self, *args, **kwargs):
        return self.transcript


def event(action, **extra):
    return {
        "action": action,
        "user_id": "user-1",
        "project_id": "project-1",
        "recording_id": "recording-1",
        "execution_arn": "arn:execution:test",
        "audio_s3_key": "users/user-1/projects/project-1/recordings/recording-1/original.wav",
        **extra,
    }


@pytest.mark.parametrize("action", ["start", "status", "analyze", "feedback"])
def test_rejects_workflow_event_for_another_project_before_side_effects(monkeypatch, action):
    module = load_processor(monkeypatch)
    store = FakeStore()
    module.payloads = lambda: store
    with pytest.raises(ValueError, match="scope"):
        module.handler(event(action, project_id="project-2"), None)
    assert store.transitions == []
    assert store.artifacts == []


def test_rejects_wrong_prepared_audio_key_before_transcribe(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore()
    store.recording.diagnostic_audio_s3_key = "users/user-1/projects/project-1/recordings/recording-1/diagnostic.wav"
    module.payloads = lambda: store
    with pytest.raises(ValueError, match="scope"):
        module.handler(event("start", audio_s3_key="users/user-1/projects/project-1/recordings/recording-1/other.wav"), None)


def test_status_returns_transcribe_state_and_failure_reason(monkeypatch):
    module = load_processor(monkeypatch)
    module.payloads = lambda: FakeStore()
    module.TRANSCRIBE = SimpleNamespace(
        get_transcription_job=lambda **kwargs: {
            "TranscriptionJob": {
                "TranscriptionJobStatus": "FAILED",
                "FailureReason": "codec error",
            }
        }
    )

    result = module.handler(event("status", transcription_job_name="job-1", transcript_s3_key="raw.json"), None)

    assert result["transcribe_status"] == "FAILED"
    assert result["failure_reason"] == "codec error"
    assert result["error"] == "codec error"


def test_status_reaches_poll_limit_and_allows_completion_on_final_poll(monkeypatch):
    module = load_processor(monkeypatch)
    module.payloads = lambda: FakeStore()
    current = {"TranscriptionJobStatus": "IN_PROGRESS"}
    module.TRANSCRIBE = SimpleNamespace(
        get_transcription_job=lambda **kwargs: {"TranscriptionJob": current}
    )
    poll_event = event("status", transcription_job_name="job-1", poll_attempts=79)

    timed_out = module.handler(poll_event, None)
    assert timed_out["poll_attempts"] == 80
    assert timed_out["error"] == "Transcription polling limit exceeded"

    current["TranscriptionJobStatus"] = "COMPLETED"
    completed = module.handler(poll_event, None)
    assert completed["poll_attempts"] == 80
    assert completed["transcribe_status"] == "COMPLETED"


def test_start_uses_prepared_wav_for_browser_webm_original(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.PROCESSING)
    store.config.data_bucket = "bucket"
    module.payloads = lambda: store
    calls = []
    module.TRANSCRIBE = SimpleNamespace(
        start_transcription_job=lambda **kwargs: calls.append(kwargs)
    )
    browser_event = event(
        "start",
        original_audio_s3_key="users/user-1/projects/project-1/recordings/recording-1/original.webm",
        audio_s3_key="users/user-1/projects/project-1/recordings/recording-1/artifacts/audio-prep/1.1.0/diagnostic.wav",
    )
    store.recording.diagnostic_audio_s3_key = browser_event["audio_s3_key"]

    result = module.handler(browser_event, None)

    assert calls[0]["MediaFormat"] == "wav"
    assert result["transcription_job_name"].startswith("test-recording-1-")
    assert result["transcription_job_name"].endswith("-raw-v1")


def test_start_replay_reuses_the_same_transcribe_job_name(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.PROCESSING)
    module.payloads = lambda: store
    calls = []
    module.TRANSCRIBE = SimpleNamespace(
        start_transcription_job=lambda **kwargs: calls.append(kwargs)
    )
    first = module.handler(event("start"), None)
    second = module.handler(event("start"), None)

    assert first["transcription_job_name"] == second["transcription_job_name"]
    assert len(calls) == 1


def test_start_recovers_when_successful_aws_call_loses_response(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.PROCESSING)
    module.payloads = lambda: store
    calls = []

    def start(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise EndpointConnectionError(endpoint_url="https://transcribe.test")
        raise ClientError({"Error": {"Code": "ConflictException", "Message": "exists"}},
                          "StartTranscriptionJob")

    module.TRANSCRIBE = SimpleNamespace(
        start_transcription_job=start,
        get_transcription_job=lambda **kwargs: {"TranscriptionJob": {
            "Media": calls[0]["Media"], "MediaFormat": "wav",
        }},
    )
    with pytest.raises(EndpointConnectionError):
        module.handler(event("start"), None)

    result = module.handler(event("start"), None)

    assert len(calls) == 2
    assert calls[0]["TranscriptionJobName"] == calls[1]["TranscriptionJobName"]
    assert result["transcription_job_name"] == calls[0]["TranscriptionJobName"]
    assert store.recording.status is RecordingStatus.TRANSCRIBING


def test_start_rejects_conflicting_job_media(monkeypatch):
    module = load_processor(monkeypatch)
    module.payloads = lambda: FakeStore()
    module.TRANSCRIBE = SimpleNamespace(
        start_transcription_job=lambda **kwargs: (_ for _ in ()).throw(
            ClientError({"Error": {"Code": "ConflictException"}}, "StartTranscriptionJob")
        ),
        get_transcription_job=lambda **kwargs: {"TranscriptionJob": {
            "Media": {"MediaFileUri": "s3://other/file.wav"}, "MediaFormat": "wav"
        }},
    )
    with pytest.raises(ValueError, match="different input"):
        module.handler(event("start"), None)


def test_start_returns_concurrent_winner_after_revision_conflict(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore()
    module.payloads = lambda: store
    module.TRANSCRIBE = SimpleNamespace(start_transcription_job=lambda **kwargs: None)
    original = store.transition_recording

    def concurrent_winner(*args, **kwargs):
        original(*args, **kwargs)
        raise WriteConflictError("concurrent writer won")

    store.transition_recording = concurrent_winner
    result = module.handler(event("start"), None)

    assert result["transcription_job_name"] == store.recording.transcription_job_name
    assert store.recording.status is RecordingStatus.TRANSCRIBING


def test_start_retries_after_job_started_but_state_write_failed(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore()
    module.payloads = lambda: store
    calls = []

    def start(**kwargs):
        calls.append(kwargs)
        if len(calls) > 1:
            raise ClientError({"Error": {"Code": "ConflictException"}}, "StartTranscriptionJob")

    module.TRANSCRIBE = SimpleNamespace(
        start_transcription_job=start,
        get_transcription_job=lambda **kwargs: {"TranscriptionJob": {
            "Media": calls[0]["Media"], "MediaFormat": "wav",
        }},
    )
    original = store.transition_recording
    store.transition_recording = lambda *args, **kwargs: (_ for _ in ()).throw(
        RuntimeError("DynamoDB unavailable"))
    with pytest.raises(RuntimeError, match="DynamoDB unavailable"):
        module.handler(event("start"), None)
    store.transition_recording = original

    result = module.handler(event("start"), None)

    assert len(calls) == 2
    assert calls[0]["TranscriptionJobName"] == calls[1]["TranscriptionJobName"]
    assert result["transcription_job_name"] == calls[0]["TranscriptionJobName"]


def test_analyze_normalizes_transcript_and_calculates_fillers(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore()
    store.stream_bytes = json.dumps(
        {
            "results": {
                "transcripts": [{"transcript": "um hello"}],
                "items": [
                    {"type": "pronunciation", "start_time": "0.0", "end_time": "1.0", "alternatives": [{"content": "um"}]},
                    {"type": "pronunciation", "start_time": "1.0", "end_time": "2.0", "alternatives": [{"content": "hello"}]},
                ],
            }
        }
    ).encode()
    module.payloads = lambda: store

    result = module.handler(event("analyze", transcript_s3_key="raw.json"), None)

    metrics = result["summary_metrics"]
    assert metrics["word_count"] == 1
    assert metrics["duration_seconds"] == 2.0
    assert metrics["words_per_minute"] == 30.0
    assert metrics["filler_words"] == {"um": 1}
    assert metrics["rubric_status"] == "insufficient_speech"
    assert all(score is None for score in metrics["rubric_scores"].values())
    assert [item["artifact_name"] for item in store.artifacts] == ["transcript", "speech_analysis"]
    assert store.transitions[-1][0] is RecordingStatus.ANALYZED


def test_analyze_rejects_oversized_raw_transcript(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore()
    store.stream_bytes = b"x" * 101
    store.config.max_transcript_payload_bytes = 100
    module.payloads = lambda: store

    with pytest.raises(ValueError, match="exceeds"):
        module.handler(event("analyze", transcript_s3_key="raw.json"), None)


@pytest.mark.parametrize("interrupt_after", [1, 2])
def test_analyze_reuses_artifacts_after_interrupted_metadata_writes(monkeypatch, interrupt_after):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.TRANSCRIBING)
    store.stream_bytes = b'{"results":{"transcripts":[{"transcript":"hello"}],"items":[]}}'
    module.payloads = lambda: store
    original = store.put_json_artifact

    def interrupted(*args, **kwargs):
        result = original(*args, **kwargs)
        if len(store.artifacts) == interrupt_after:
            raise RuntimeError("response lost after metadata write")
        return result

    store.put_json_artifact = interrupted
    with pytest.raises(RuntimeError):
        module.handler(event("analyze", transcript_s3_key="raw.json"), None)
    store.put_json_artifact = original

    result = module.handler(event("analyze", transcript_s3_key="raw.json"), None)

    assert result["summary_metrics"]["word_count"] == 0
    assert len(store.artifacts) == 2
    assert store.recording.status is RecordingStatus.ANALYZED


def test_analyze_replays_after_successful_transition_loses_response(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.TRANSCRIBING)
    store.stream_bytes = b'{"results":{"transcripts":[{"transcript":"hello"}],"items":[]}}'
    module.payloads = lambda: store
    original = store.transition_recording

    def interrupted(*args, **kwargs):
        result = original(*args, **kwargs)
        raise RuntimeError("response lost after transition")

    store.transition_recording = interrupted
    with pytest.raises(RuntimeError):
        module.handler(event("analyze", transcript_s3_key="raw.json"), None)
    store.transition_recording = original
    result = module.handler(event("analyze", transcript_s3_key="raw.json"), None)

    assert result["summary_metrics"]["word_count"] == 0
    assert len(store.artifacts) == 2
    assert len(store.transitions) == 1


def test_analyze_persists_dynamodb_compatible_metrics(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.TRANSCRIBING)
    store.stream_bytes = json.dumps({"results": {"transcripts": [{"transcript": "hello"}],
                                         "items": [{"type": "pronunciation", "start_time": "0.0", "end_time": "1.3",
                                                    "alternatives": [{"content": "hello"}]}]}}).encode()
    module.payloads = lambda: store

    module.handler(event("analyze", transcript_s3_key="raw.json"), None)

    metrics = store.transitions[-1][2]["summary_metrics"]
    TypeSerializer().serialize(metrics)
    assert module.handler(event("analyze", transcript_s3_key="raw.json"), None)["summary_metrics"]["duration_seconds"] == 1.3


def test_analyze_replays_historical_metrics_without_replacing_artifacts(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.ANALYZED)
    store.recording.summary_metrics = {"word_count": 2, "words_per_minute": 60}
    for payload_type, producer, name in (
        (PayloadType.TRANSCRIPT, "speakup-transcript-normalizer", "transcript"),
        (PayloadType.SPEECH_ANALYSIS, "speakup-speech-analysis", "speech_analysis"),
    ):
        store.recording.payload_refs[payload_type.value] = {
            "key": artifact_key("user-1", "project-1", "recording-1", producer=producer,
                                producer_version="1.0.0", artifact_name=name,
                                content_type="application/json"),
            "user_id": "user-1", "project_id": "project-1", "recording_id": "recording-1",
            "payload_type": payload_type.value, "producer": producer,
            "producer_version": "1.0.0",
        }
    module.payloads = lambda: store
    result = module.handler(event("analyze", transcript_s3_key="raw.json"), None)
    assert result["summary_metrics"] == {"word_count": 2, "words_per_minute": 60}
    assert store.artifacts == []
    assert store.transitions == []


def test_analyze_recreates_missing_persisted_object_on_replay(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.TRANSCRIBING)
    store.stream_bytes = b'{"results":{"transcripts":[{"transcript":"hello"}],"items":[]}}'
    module.payloads = lambda: store
    first = module.handler(event("analyze", transcript_s3_key="raw.json"), None)
    store.missing_artifacts.add(PayloadType.SPEECH_ANALYSIS)
    original = store.put_json_artifact

    def restored(*args, **kwargs):
        result = original(*args, **kwargs)
        store.missing_artifacts.discard(kwargs["payload_type"])
        return result

    store.put_json_artifact = restored
    replay = module.handler(event("analyze", transcript_s3_key="raw.json"), None)

    assert replay["analysis_s3_key"] == first["analysis_s3_key"]
    assert [artifact["artifact_name"] for artifact in store.artifacts] == [
        "transcript", "speech_analysis", "speech_analysis"
    ]
    assert len(store.transitions) == 1


def test_analyze_reconciles_s3_write_before_metadata_patch(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.TRANSCRIBING)
    store.stream_bytes = b'{"results":{"transcripts":[{"transcript":"hello"}],"items":[]}}'
    module.payloads = lambda: store
    original = store.put_json_artifact
    orphan = {}

    def interrupted(*args, **kwargs):
        if not orphan:
            orphan.update(kwargs)
            raise RuntimeError("response lost after S3 write")
        return original(*args, **kwargs)

    def reconcile(*args, **kwargs):
        if orphan and kwargs["payload_type"] == orphan["payload_type"]:
            key = artifact_key(args[0], "project-1", args[1], producer=kwargs["producer"],
                               producer_version=kwargs["producer_version"],
                               artifact_name=kwargs["artifact_name"], content_type="application/json")
            raw = {"key": key, "user_id": args[0], "project_id": "project-1",
                   "recording_id": args[1], "payload_type": kwargs["payload_type"].value,
                   "producer": kwargs["producer"],
                   "producer_version": kwargs["producer_version"]}
            store.recording.payload_refs[kwargs["payload_type"].value] = raw
            store.recording.revision += 1
            return store.recording, SimpleNamespace(as_dict=lambda: raw)
        return None

    store.put_json_artifact = interrupted
    store.reconcile_json_artifact = reconcile
    with pytest.raises(RuntimeError):
        module.handler(event("analyze", transcript_s3_key="raw.json"), None)
    result = module.handler(event("analyze", transcript_s3_key="raw.json"), None)

    assert result["summary_metrics"]["word_count"] == 0
    assert len(store.artifacts) == 1


def test_feedback_reuses_existing_feedback_without_calling_bedrock(monkeypatch):
    module = load_processor(monkeypatch)
    key = artifact_key("user-1", "project-1", "recording-1", producer="speakup-coach",
                       producer_version=module.FEEDBACK_VERSION, artifact_name="feedback",
                       content_type="application/json")
    store = FakeStore(
        status=RecordingStatus.ANALYZED,
        feedback_ref={"key": key, "user_id": "user-1", "project_id": "project-1",
                      "recording_id": "recording-1", "payload_type": PayloadType.FEEDBACK.value,
                      "producer": "speakup-coach", "producer_version": module.FEEDBACK_VERSION},
    )
    module.payloads = lambda: store
    module.BEDROCK = SimpleNamespace(converse=lambda **kwargs: pytest.fail("Bedrock must not run"))

    result = module.handler(event("feedback", summary_metrics={"word_count": 2}), None)

    assert result["status"] == RecordingStatus.COMPLETE.value
    assert store.transitions[-1][2] == {"feedback_s3_key": key}


def test_feedback_replays_historical_artifact_without_rewriting(monkeypatch):
    module = load_processor(monkeypatch)
    key = artifact_key("user-1", "project-1", "recording-1", producer="speakup-coach",
                       producer_version="1.0.0", artifact_name="feedback",
                       content_type="application/json")
    store = FakeStore(status=RecordingStatus.COMPLETE, feedback_ref={
        "key": key, "user_id": "user-1", "project_id": "project-1",
        "recording_id": "recording-1", "payload_type": PayloadType.FEEDBACK.value,
        "producer": "speakup-coach", "producer_version": "1.0.0",
    })
    module.payloads = lambda: store
    result = module.handler(event("feedback"), None)
    assert result["status"] == "COMPLETE"
    assert store.artifacts == []


def test_feedback_rejects_foreign_artifact_reference(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.ANALYZED, feedback_ref={
        "key": "users/other/feedback.json", "user_id": "other", "project_id": "project-1",
        "recording_id": "recording-1", "payload_type": PayloadType.FEEDBACK.value,
        "producer": "speakup-coach", "producer_version": "1.0.0",
    })
    module.payloads = lambda: store
    module.BEDROCK = SimpleNamespace(converse=lambda **kwargs: pytest.fail("Bedrock must not run"))

    with pytest.raises(ValueError, match="does not match"):
        module.handler(event("feedback", summary_metrics={"word_count": 2}), None)
    assert store.transitions == []


def test_feedback_generates_and_persists_model_output(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(
        status=RecordingStatus.ANALYZED,
        transcript={"data": {"text": "x" * 10_000}},
    )
    module.payloads = lambda: store
    module.BEDROCK = SimpleNamespace(
        converse=lambda **kwargs: {"output": {"message": {"content": [{"text": "Practice pauses."}]}}}
    )

    result = module.handler(
        event("feedback", summary_metrics={"word_count": 2}, transcript_text="secret"),
        None,
    )

    assert result["status"] == RecordingStatus.COMPLETE.value
    assert "transcript_text" not in result
    assert store.artifacts[-1]["data"]["feedback"] == "Practice pauses."


def test_feedback_uses_persisted_metrics_over_workflow_event(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.ANALYZED)
    store.recording.summary_metrics = {
        "rubric_status": "scored", "rubric_scores": {"speaking_rate": 4},
    }
    module.payloads = lambda: store
    calls = []
    module.BEDROCK = SimpleNamespace(
        converse=lambda **kwargs: (calls.append(kwargs) or {
            "output": {"message": {"content": [{"text": "Practice pauses."}]}}
        })
    )

    module.handler(event("feedback", summary_metrics={"rubric_scores": {"speaking_rate": 0}}), None)

    prompt = json.loads(calls[0]["messages"][0]["content"][0]["text"])
    assert prompt["metrics"] == store.recording.summary_metrics


def test_feedback_rejects_missing_persisted_metrics(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.ANALYZED)
    store.recording.summary_metrics = {}
    module.payloads = lambda: store
    module.BEDROCK = SimpleNamespace(converse=lambda **kwargs: pytest.fail("Bedrock must not run"))
    with pytest.raises(ValueError, match="persisted metrics"):
        module.handler(event("feedback", summary_metrics={"word_count": 2}), None)


def test_feedback_rejects_transcript_over_model_input_bound(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(
        status=RecordingStatus.ANALYZED,
        transcript={"data": {"text": "x" * 10_000}},
    )
    module.payloads = lambda: store
    monkeypatch.setenv("BEDROCK_MAX_INPUT_CHARS", "4000")
    module.BEDROCK = SimpleNamespace(
        converse=lambda **kwargs: pytest.fail("oversized prompt must not call Bedrock")
    )
    with pytest.raises(ValueError, match="too large"):
        module.handler(
            event("feedback", summary_metrics={"word_count": 2}),
            None,
        )


@pytest.mark.parametrize("lost_response", ["artifact", "transition"])
def test_feedback_replay_does_not_call_bedrock_twice(monkeypatch, lost_response):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.ANALYZED)
    module.payloads = lambda: store
    calls = []
    module.BEDROCK = SimpleNamespace(
        converse=lambda **kwargs: (calls.append(kwargs) or {
            "output": {"message": {"content": [{"text": "Practice pauses."}]}}
        })
    )
    method = "put_json_artifact" if lost_response == "artifact" else "transition_recording"
    original = getattr(store, method)

    def interrupted(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("successful response lost")

    setattr(store, method, interrupted)
    feedback_event = event("feedback", summary_metrics={"word_count": 2})
    with pytest.raises(RuntimeError):
        module.handler(feedback_event, None)
    setattr(store, method, original)

    result = module.handler(feedback_event, None)

    assert result["status"] == RecordingStatus.COMPLETE.value
    assert len(calls) == 1
    assert len(store.artifacts) == 1


def test_fail_is_idempotent_for_already_failed_recording(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.FAILED)
    module.payloads = lambda: store

    result = module.handler(event("fail", error="timeout"), None)

    assert result["status"] == RecordingStatus.FAILED.value
    assert store.transitions == []


def test_fail_rejects_wrong_execution_scope(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.PROCESSING)
    module.payloads = lambda: store

    with pytest.raises(ValueError, match="execution"):
        module.handler(event("fail", execution_arn="arn:execution:other"), None)
    assert store.transitions == []


def test_fail_replay_after_lost_transition_response(monkeypatch):
    module = load_processor(monkeypatch)
    store = FakeStore(status=RecordingStatus.PROCESSING)
    module.payloads = lambda: store
    original = store.transition_recording

    def interrupted(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("successful response lost")

    store.transition_recording = interrupted
    with pytest.raises(RuntimeError):
        module.handler(event("fail", error="worker error"), None)
    store.transition_recording = original

    assert module.handler(event("fail", error="worker error"), None)["status"] == "FAILED"
    assert len(store.transitions) == 1
