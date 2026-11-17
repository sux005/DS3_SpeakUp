"""Cross-layer QA for the upload-to-analysis pipeline and frontend contracts."""

from __future__ import annotations

import json
from types import SimpleNamespace

from src.aws_payload.models import PayloadType, Recording, RecordingStatus

from tests.test_aws_payload_api_handler import authenticated_event, load_handler_module
from tests.test_workflow_simulation import WorkflowSimulation, initial_input


def s3_created_event(*, bucket: str = "data-bucket") -> dict[str, object]:
    return {
        "id": "event-1",
        "source": "aws.s3",
        "detail-type": "Object Created",
        "detail": {
            "bucket": {"name": bucket},
            "object": {
                "key": "users/user-1/projects/project-1/recordings/recording-1/original.wav"
            },
        },
    }


def test_original_upload_trigger_starts_processing_for_event_recording(monkeypatch):
    module = load_handler_module()
    calls = []

    monkeypatch.setenv("DATA_BUCKET", "data-bucket")
    monkeypatch.setattr(module, "payloads", lambda: SimpleNamespace())

    def process(store, user_id, recording_id, *, expected_project_id=None):
        calls.append((store, user_id, recording_id, expected_project_id))
        return {"statusCode": 202}

    monkeypatch.setattr(module, "_process_recording", process)

    result = module.upload_handler(s3_created_event(), None)

    assert result == {"recording_id": "recording-1", "status_code": 202}
    assert len(calls) == 1
    assert calls[0][1:] == ("user-1", "recording-1", "project-1")


def test_successful_workflow_hands_prepared_audio_and_analysis_to_next_steps():
    simulation = WorkflowSimulation(poll_statuses=["COMPLETED"])

    result, _ = simulation.run(initial_input())

    assert result == "SUCCEEDED"
    by_name = {name: payload for name, payload in simulation.calls}
    assert by_name["PreprocessAudio"]["audio_s3_key"].endswith("/original.wav")
    assert by_name["StartTranscription"]["audio_s3_key"].endswith("/diagnostic.wav")
    assert by_name["AnalyzeSpeech"]["transcript_s3_key"].endswith("/transcript.json")
    assert by_name["GenerateFeedback"]["analysis_s3_key"] == "analysis.json"
    assert by_name["GenerateFeedback"]["summary_metrics"] == {"word_count": 3}


def test_analysis_artifact_contract_exposes_metrics_without_producer_metadata(monkeypatch):
    module = load_handler_module()
    document = {
        "producer": "speakup-speech-analysis",
        "data": {"metrics": {"word_count": 3, "filler_occurrences": []}},
    }
    monkeypatch.setattr(
        module,
        "payloads",
        lambda: SimpleNamespace(
            get_json_artifact=lambda user_id, recording_id, payload_type: document
        ),
    )

    response = module.handler(
        authenticated_event(
            "GET /recordings/{recordingId}/artifacts/{artifactType}",
            path={"recordingId": "recording-1", "artifactType": "analysis"},
        ),
        None,
    )

    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body == {
        "recording_id": "recording-1",
        "artifact_type": "analysis",
        "data": document["data"],
    }
    assert "producer" not in body


def test_review_contract_returns_null_feedback_when_optional_generation_is_disabled(monkeypatch):
    module = load_handler_module()
    recording = Recording(
        "user-1", "project-1", "recording-1", "2026-01-01T00:00:00Z",
        "2026-01-01T00:01:00Z", status=RecordingStatus.COMPLETE,
        summary_metrics={"word_count": 3},
    )

    class Store:
        def get_recording(self, user_id, recording_id):
            assert (user_id, recording_id) == ("user-1", "recording-1")
            return recording

        def get_json_artifact(self, user_id, recording_id, payload_type):
            from src.aws_payload.errors import PayloadNotFoundError

            assert (user_id, recording_id) == ("user-1", "recording-1")
            if payload_type is PayloadType.TRANSCRIPT:
                return {"data": {"text": "hello", "items": []}}
            raise PayloadNotFoundError("feedback disabled")

    monkeypatch.setattr(module, "payloads", lambda: Store())
    response = module.handler(
        authenticated_event(
            "GET /recordings/{recordingId}/review",
            path={"recordingId": "recording-1"},
        ),
        None,
    )

    assert response["statusCode"] == 200
    assert json.loads(response["body"])["feedback"] is None


def test_review_contract_preserves_structured_feedback_for_frontend(monkeypatch):
    module = load_handler_module()
    recording = Recording(
        "user-1", "project-1", "recording-1", "2026-01-01T00:00:00Z",
        "2026-01-01T00:01:00Z", status=RecordingStatus.COMPLETE,
    )
    feedback = {
        "data": {
            "feedback": "Clear opening.",
            "schema_version": 2,
            "categories": {
                "pace": {"observation": "150 WPM.", "next_step": "Keep this pace."}
            },
            "moments": [{"id": "s1", "kind": "strength", "text": "hello"}],
            "model_id": "private-model",
        }
    }

    class Store:
        def get_recording(self, *_):
            return recording

        def get_json_artifact(self, _user_id, _recording_id, payload_type):
            if payload_type is PayloadType.TRANSCRIPT:
                return {"data": {"text": "hello", "items": []}}
            return feedback

    monkeypatch.setattr(module, "payloads", lambda: Store())
    response = module.handler(
        authenticated_event(
            "GET /recordings/{recordingId}/review",
            path={"recordingId": "recording-1"},
        ),
        None,
    )

    assert response["statusCode"] == 200
    public_feedback = json.loads(response["body"])["feedback"]
    assert public_feedback["categories"]["pace"]["next_step"] == "Keep this pace."
    assert public_feedback["moments"][0]["id"] == "s1"
    assert "model_id" not in public_feedback


def test_feedback_artifact_contract_preserves_structured_feedback_for_legacy_frontend(monkeypatch):
    module = load_handler_module()
    feedback = {
        "data": {
            "feedback": "Clear opening.",
            "schema_version": 2,
            "categories": {"pace": {"observation": "150 WPM.", "next_step": "Keep this pace."}},
            "moments": [{"id": "s1", "kind": "strength", "text": "hello"}],
            "metrics": {"words_per_minute": 150},
            "model_id": "private-model",
        }
    }

    class Store:
        def get_json_artifact(self, _user_id, _recording_id, _payload_type):
            return feedback

    monkeypatch.setattr(module, "payloads", lambda: Store())
    response = module.handler(
        authenticated_event(
            "GET /recordings/{recordingId}/artifacts/{artifactType}",
            path={"recordingId": "recording-1", "artifactType": "feedback"},
        ),
        None,
    )

    assert response["statusCode"] == 200
    public_feedback = json.loads(response["body"])["data"]
    assert public_feedback["categories"]["pace"]["next_step"] == "Keep this pace."
    assert public_feedback["moments"][0]["id"] == "s1"
    assert "model_id" not in public_feedback
