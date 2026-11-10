"""Contract tests for the audio-preparation Lambda adapter."""

from __future__ import annotations

import importlib.util
import hashlib
import io
import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

from src.audio.config import AudioPrepConfig
from src.aws_payload.models import PayloadRef, PayloadType, Recording, RecordingStatus
from src.aws_payload.errors import WriteConflictError


MODULE_PATH = Path(__file__).parents[1] / "infra" / "lambda" / "audio_prep" / "index.py"
SPEC = importlib.util.spec_from_file_location("audio_prep_handler", MODULE_PATH)
audio_prep = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(audio_prep)


def event():
    return {
        "user_id": "user-1",
        "project_id": "project-1",
        "recording_id": "recording-1",
        "audio_s3_key": "users/user-1/projects/project-1/recordings/recording-1/original.webm",
    }


def report(config: AudioPrepConfig):
    return {
        "pipeline_version": config.pipeline_version,
        "producer_version": config.artifact_version(),
        "config_fingerprint": config.fingerprint(),
        "source": {"etag": "etag-1"},
        "output": {"selected_for_transcription": "diagnostic"},
        "warnings": [],
    }


class FakeObjects:
    def __init__(self, document):
        self.document = document

    def find_json(self, *args, **kwargs):
        if self.document is None:
            return None
        version = kwargs["producer_version"]
        name = kwargs["artifact_name"]
        key = audio_prep._artifact_keys(
            "user-1", "project-1", "recording-1", version
        )["report"]
        return SimpleNamespace(
            key=key,
            as_dict=lambda: {"key": key},
        )

    def get_json(self, reference):
        return self.document


class FakeS3:
    class exceptions:
        class NoSuchKey(Exception):
            pass

    def __init__(self):
        self.corrupt = False

    def head_object(self, **kwargs):
        body = b"valid-audio"
        key = kwargs["Key"]
        if "/audio-prep/" not in key:
            return {"ContentLength": 12, "ETag": '"etag-1"'}
        version = key.split("/audio-prep/", 1)[1].split("/", 1)[0]
        return {
            "ContentLength": len(body),
            "ContentType": "audio/wav",
            "ETag": '"etag-1"',
            "Metadata": {
                "payload-type": PayloadType.AUDIO_PREP_ARTIFACT.value,
                "producer": "audio-prep",
                "producer-version": version,
                "recording-id": "recording-1",
                "sha256": hashlib.sha256(body).hexdigest(),
            },
        }

    def get_object(self, **kwargs):
        if not kwargs["Key"].endswith(".wav"):
            raise self.exceptions.NoSuchKey()
        body = b"corrupt-audio" if self.corrupt else b"valid-audio"
        return {"Body": io.BytesIO(body)}


def fake_service(document=None):
    config = AudioPrepConfig(enhancement_backend="none")
    recording = Recording(
        "user-1", "project-1", "recording-1", "2026-01-01", "2026-01-01",
        RecordingStatus.PROCESSING, "audio/webm", event()["audio_s3_key"],
        payload_refs={"existing": {"key": "existing"}},
    )
    s3 = FakeS3()
    return SimpleNamespace(
        config=SimpleNamespace(data_bucket="bucket", max_audio_upload_bytes=100),
        factory=SimpleNamespace(s3_client=s3),
        objects=FakeObjects(document),
        recordings=SimpleNamespace(get=lambda user, recording_id: recording, patch=lambda *args, **kwargs: None),
        get_recording=lambda user, recording_id: recording,
    ), config


def test_deployed_build_does_not_reuse_report_from_other_build(monkeypatch):
    config = AudioPrepConfig(enhancement_backend="none")
    old = report(config)
    old["producer_version"] = "2.0.0-old-build"
    service, _ = fake_service({"data": {"report": old}})
    monkeypatch.setattr(audio_prep, "payloads", lambda: service)
    monkeypatch.setenv("AUDIO_BUILD_DIGEST", "new-build")
    assert audio_prep._existing_report(event(), "etag-1", config) is None


def test_legacy_artifact_layout_uses_one_compatibility_manifest():
    keys = audio_prep._legacy_artifact_keys(
        "user-1", "project-1", "recording-1", "1.1.0"
    )
    assert set(keys) == set(audio_prep._ARTIFACT_FILES)
    assert keys["diagnostic"].endswith("/diagnostic.wav")
    assert keys["report"].endswith("/report.json")


def test_reuses_matching_report_and_returns_deterministic_artifact_references(monkeypatch):
    config = AudioPrepConfig(enhancement_backend="none")
    monkeypatch.setenv("AUDIO_ENHANCEMENT_BACKEND", "none")
    service, _ = fake_service({"data": {"report": report(config)}})
    monkeypatch.setattr(audio_prep, "payloads", lambda: service)
    result = audio_prep.handler(event(), None)
    assert result["preprocess_reused"] is True
    assert result["diagnostic_audio_s3_key"].endswith(
        f"/artifacts/audio-prep/{config.pipeline_version}/diagnostic.wav"
    )
    assert result["transcription_audio_s3_key"] == result["diagnostic_audio_s3_key"]


def test_reuse_repairs_missing_recording_metadata(monkeypatch):
    config = AudioPrepConfig(enhancement_backend="none")
    monkeypatch.setenv("AUDIO_ENHANCEMENT_BACKEND", "none")
    service, _ = fake_service({"data": {"report": report(config)}})
    patches = []
    service.recordings.patch = lambda *args, **kwargs: patches.append(kwargs)
    monkeypatch.setattr(audio_prep, "payloads", lambda: service)

    audio_prep.handler(event(), None)

    assert patches
    assert patches[0]["updates"]["audio_prep_status"] == "COMPLETE"


def test_corrupt_reused_wav_fails_closed_and_is_not_attached():
    config = AudioPrepConfig(enhancement_backend="none")
    service, _ = fake_service({"data": {"report": report(config)}})
    service.factory.s3_client.corrupt = True
    keys = audio_prep._artifact_keys(
        "user-1", "project-1", "recording-1", config.pipeline_version
    )
    report_reference = SimpleNamespace(
        key=keys["report"],
        as_dict=lambda: {"key": keys["report"]},
    )

    assert audio_prep._reuse_metadata(
        service,
        service.get_recording("user-1", "recording-1"),
        event(),
        report(config),
        keys,
        report_reference,
    ) is False


def test_reused_pcm_may_exceed_compressed_upload_limit():
    service, config = fake_service()
    service.config.max_audio_upload_bytes = 1
    key = audio_prep._artifact_keys(
        "user-1", "project-1", "recording-1", config.artifact_version()
    )["diagnostic"]
    assert audio_prep._validated_audio_artifact(
        service, key,
        user_id="user-1", project_id="project-1", recording_id="recording-1",
        producer_version=config.artifact_version(),
    ) is not None


def test_reuse_does_not_rewrite_complete_metadata(monkeypatch):
    config = AudioPrepConfig(enhancement_backend="none")
    monkeypatch.setenv("AUDIO_ENHANCEMENT_BACKEND", "none")
    service, _ = fake_service({"data": {"report": report(config)}})
    keys = audio_prep._artifact_keys("user-1", "project-1", "recording-1", config.pipeline_version)
    references = {f"audio-prep.{name}.v1": {"key": keys[name]}
                  for name in ("reference", "enhanced_model", "enhanced_blended", "diagnostic")}
    references[PayloadType.PREPROCESS_REPORT.value] = {"key": keys["report"]}
    complete = replace(service.get_recording("user-1", "recording-1"),
                       payload_refs=references, audio_prep_status="COMPLETE",
                       reference_audio_s3_key=keys["reference"],
                       enhanced_audio_s3_key=keys["diagnostic"],
                       diagnostic_audio_s3_key=keys["diagnostic"],
                       preprocess_report_s3_key=keys["report"])
    service.get_recording = lambda *args: complete
    service.recordings.patch = lambda *args, **kwargs: pytest.fail("complete metadata must not be rewritten")
    monkeypatch.setattr(audio_prep, "payloads", lambda: service)

    assert audio_prep.handler(event(), None)["preprocess_reused"] is True


def test_missing_reused_artifact_is_regenerated(monkeypatch):
    config = AudioPrepConfig(enhancement_backend="none")
    monkeypatch.setenv("AUDIO_ENHANCEMENT_BACKEND", "none")
    service, _ = fake_service({"data": {"report": report(config)}})
    uploaded = []
    patches = []

    def head(**kwargs):
        if kwargs["Key"].endswith("/diagnostic.wav"):
            raise FakeS3.exceptions.NoSuchKey()
        return {"ContentLength": 12, "ETag": '"etag-1"'}

    def process(source, output, config, source_metadata):
        output.mkdir()
        artifacts = {}
        for name in ("reference", "enhanced_model", "enhanced_blended", "diagnostic"):
            path = output / f"{name}.wav"
            path.write_bytes(b"wav")
            artifacts[name] = path
        path = output / "report.json"
        path.write_text(json.dumps(report(config)), encoding="utf-8")
        artifacts["report"] = path
        return artifacts

    def reference(name, payload_type):
        return PayloadRef("user-1", "project-1", "recording-1", f"key-{name}",
                          payload_type, "application/json", 1, "sha", "audio-prep",
                          config.pipeline_version)

    service.factory.s3_client.head_object = head
    service.factory.s3_client.download_file = lambda bucket, key, target: Path(target).write_bytes(b"audio")
    service.objects.put_file = lambda path, **kwargs: (uploaded.append(kwargs["artifact_name"])
                                                     or reference(kwargs["artifact_name"], PayloadType.AUDIO_PREP_ARTIFACT))
    service.objects.put_json = lambda *args, **kwargs: reference("report", PayloadType.PREPROCESS_REPORT)
    service.recordings.patch = lambda *args, **kwargs: patches.append(kwargs)
    monkeypatch.setattr(audio_prep, "process_audio_file", process)
    monkeypatch.setattr(audio_prep, "payloads", lambda: service)

    result = audio_prep.handler(event(), None)

    assert result["preprocess_reused"] is False
    assert uploaded == ["reference", "enhanced_model", "enhanced_blended", "diagnostic"]
    assert len(patches) == 1


def test_reuse_metadata_retries_after_concurrent_revision_change(monkeypatch):
    config = AudioPrepConfig(enhancement_backend="none")
    monkeypatch.setenv("AUDIO_ENHANCEMENT_BACKEND", "none")
    service, _ = fake_service({"data": {"report": report(config)}})
    attempts = []

    def patch(*args, **kwargs):
        attempts.append(kwargs)
        if len(attempts) == 1:
            raise WriteConflictError("another writer updated the recording")

    service.recordings.patch = patch
    service.factory.s3_client.download_file = lambda *args: pytest.fail("valid artifacts must be reused")
    monkeypatch.setattr(audio_prep, "payloads", lambda: service)

    with pytest.raises(WriteConflictError):
        audio_prep.handler(event(), None)
    assert audio_prep.handler(event(), None)["preprocess_reused"] is True
    assert len(attempts) == 2


def test_rejects_oversized_original_before_downloading(monkeypatch):
    service, _ = fake_service()
    service.factory.s3_client.head_object = lambda **kwargs: {"ContentLength": 101, "ETag": '"etag-1"'}
    monkeypatch.setenv("AUDIO_MAX_UPLOAD_BYTES", "100")
    monkeypatch.setattr(audio_prep, "payloads", lambda: service)
    with pytest.raises(ValueError, match="exceeds"):
        audio_prep.handler(event(), None)


def test_audio_prep_reads_confirmed_original_version(monkeypatch):
    service, config = fake_service()
    source_ref = {
        "key": event()["audio_s3_key"],
        "version_id": "original-version-7",
    }
    original_get = service.get_recording
    recording = replace(original_get("user-1", "recording-1"), payload_refs={PayloadType.ORIGINAL_AUDIO.value: source_ref})
    service.get_recording = lambda user, recording_id: recording
    observed = {}
    service.objects.find_json = lambda *args, **kwargs: None
    service.factory.s3_client.download_file = lambda bucket, key, target, **kwargs: (
        observed.update(bucket=bucket, key=key, args=kwargs) or Path(target).write_bytes(b"audio")
    )
    service.factory.s3_client.head_object = lambda **kwargs: {
        "ContentLength": 12, "ETag": '"etag-1"', "VersionId": kwargs.get("VersionId", "original-version-7")
    }
    service.objects.put_file = lambda path, **kwargs: PayloadRef(
        "user-1", "project-1", "recording-1", f"key-{kwargs['artifact_name']}",
        PayloadType.AUDIO_PREP_ARTIFACT, "audio/wav", 3, "sha", "audio-prep", config.artifact_version(),
    )
    service.objects.put_json = lambda *args, **kwargs: PayloadRef(
        "user-1", "project-1", "recording-1", "key-report", PayloadType.PREPROCESS_REPORT,
        "application/json", 3, "sha", "audio-prep", config.artifact_version(),
    )
    service.recordings.patch = lambda *args, **kwargs: None

    def fake_process(source, output, config, source_metadata):
        assert source_metadata["version_id"] == "original-version-7"
        output.mkdir()
        files = {}
        for name in ("reference", "enhanced_model", "enhanced_blended", "diagnostic"):
            path = output / f"{name}.wav"
            path.write_bytes(b"wav")
            files[name] = path
        report_path = output / "report.json"
        report_path.write_text(json.dumps(report(config)), encoding="utf-8")
        files["report"] = report_path
        return files

    monkeypatch.setattr(audio_prep, "process_audio_file", fake_process)
    monkeypatch.setattr(audio_prep, "payloads", lambda: service)
    audio_prep.handler(event(), None)
    assert observed["key"] == event()["audio_s3_key"]
    assert observed["args"] == {"ExtraArgs": {"VersionId": "original-version-7"}}


def test_rejects_event_scope_that_does_not_match_persisted_recording(monkeypatch):
    service, _ = fake_service()
    original_get = service.get_recording
    service.get_recording = lambda user, recording_id: replace(
        original_get(user, recording_id), project_id="another-project"
    )
    monkeypatch.setattr(audio_prep, "payloads", lambda: service)
    with pytest.raises(Exception, match="persisted recording scope"):
        audio_prep.handler(event(), None)


def test_partial_artifact_upload_propagates_failure_without_marking_recording_complete(monkeypatch, tmp_path):
    service, config = fake_service()
    service.factory.s3_client.download_file = lambda bucket, key, target: Path(target).write_bytes(b"audio")
    service.objects.find_json = lambda *args, **kwargs: None
    uploaded = []

    def put_file(path, **kwargs):
        uploaded.append(kwargs["artifact_name"])
        if len(uploaded) == 2:
            raise RuntimeError("S3 unavailable")
        return PayloadRef("user-1", "project-1", "recording-1", "key", PayloadType.AUDIO_PREP_ARTIFACT, "audio/wav", 1, "sha", "audio-prep", config.pipeline_version)

    service.objects.put_file = put_file
    service.recordings.patch = lambda *args, **kwargs: pytest.fail("metadata must not be marked complete")
    service.factory.s3_client.head_object = lambda **kwargs: {"ContentLength": 12, "ETag": '"etag-1"'}

    def fake_process(source, output, config, source_metadata):
        output.mkdir()
        files = {}
        for name in ("reference", "enhanced_model", "enhanced_blended", "diagnostic"):
            path = output / f"{name}.wav"
            path.write_bytes(b"wav")
            files[name] = path
        report_path = output / "report.json"
        report_path.write_text(json.dumps(report(config)), encoding="utf-8")
        files["report"] = report_path
        return files

    monkeypatch.setattr(audio_prep, "process_audio_file", fake_process)
    monkeypatch.setattr(audio_prep, "payloads", lambda: service)
    with pytest.raises(RuntimeError, match="S3 unavailable"):
        audio_prep.handler(event(), None)
    assert uploaded == ["reference", "enhanced_model"]
