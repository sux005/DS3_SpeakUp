import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from src.aws_payload.config import PayloadConfig
from src.aws_payload.checksum import sha256_base64_to_hex
from src.aws_payload.errors import (
    IdentifierValidationError,
    JsonValidationError,
    OwnershipViolationError,
    PayloadTooLargeError,
)
from src.aws_payload.keys import (
    artifact_key,
    original_audio_key,
    owner_project_id,
    require_owned_key,
)
from src.aws_payload.models import PayloadType, Recording


@pytest.mark.parametrize("status,updated_at,recovery_until", [
    ("FAILED", "2026-01-01T00:00:00Z", None),
    ("DELETED", "2026-02-01T00:00:00Z", "2026-02-08T00:00:00Z"),
    ("PURGE_PENDING", "2026-02-01T00:00:00Z", None),
])
def test_retention_cleanup_stages_directly_before_purge(status, updated_at, recovery_until):
    from src.aws_payload.service import SpeakUpPayloadStore

    calls = []
    current = {
        "user_id": "user-1", "project_id": "project-1", "recording_id": "recording-1",
        "status": status, "updated_at": updated_at, "created_at": updated_at,
        "revision": 4, "purge_token": "existing-token",
    }
    if recovery_until:
        current["recovery_until"] = recovery_until
    recordings = SimpleNamespace(
        get=lambda *args, **kwargs: current,
        stage_retention_purge=lambda *args, **kwargs: (
            calls.append("stage") or {**current, "status": "PURGE_PENDING", "revision": 5}
        ),
        finalize_permanent_delete=lambda *args, **kwargs: calls.append("finalize"),
    )
    objects = SimpleNamespace(
        purge_recording=lambda *args: calls.append("purge") or 2
    )
    store = SimpleNamespace(
        config=SimpleNamespace(abandoned_retention_days=7),
        recordings=recordings, objects=objects,
    )
    result = SpeakUpPayloadStore.cleanup_expired_recording(
        store, "user-1", "recording-1",
        now=datetime(2026, 2, 10, tzinfo=timezone.utc),
    )
    assert result == 2
    assert calls == (["purge", "finalize"] if status == "PURGE_PENDING" else ["stage", "purge", "finalize"])


def test_internal_upload_reservation_rejects_client_chosen_recording_id():
    from src.aws_payload.errors import PayloadValidationError
    from src.aws_payload.service import SpeakUpPayloadStore

    store = SimpleNamespace(get_project=lambda *args: object())
    with pytest.raises(PayloadValidationError, match="deterministic idempotency"):
        SpeakUpPayloadStore.reserve_upload(
            store, "user-1", "project-1", "audio/wav",
            idempotency_key="request-1", recording_id="client-chosen-id",
        )


@pytest.mark.parametrize("value", [None, "", "not-base64", "YWJj", "A" * 44])
def test_sha256_base64_parser_rejects_noncanonical_values(value):
    assert sha256_base64_to_hex(value) is None


def test_sha256_base64_parser_returns_hex_for_canonical_digest():
    import base64
    import hashlib

    digest = hashlib.sha256(b"audio bytes").digest()
    encoded = base64.b64encode(digest).decode("ascii")
    assert sha256_base64_to_hex(encoded) == digest.hex()
    assert sha256_base64_to_hex(encoded.rstrip("=")) is None


def test_recording_round_trips_terminal_response_fields():
    raw = {
        "user_id": "user-1", "project_id": "project-1",
        "recording_id": "recording-1", "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:01:00Z", "status": "FAILED",
        "feedback_s3_key": "users/user-1/projects/project-1/recordings/recording-1/feedback.json",
        "failure_reason": "Transcription failed",
    }
    result = Recording.from_item(raw).as_item()
    assert result["feedback_s3_key"] == raw["feedback_s3_key"]
    assert result["failure_reason"] == raw["failure_reason"]


def test_stored_reference_must_match_requested_recording():
    from src.aws_payload.service import SpeakUpPayloadStore

    recording = Recording(
        user_id="user-1", project_id="project-1", recording_id="recording-1",
        created_at="2026-01-01T00:00:00Z", updated_at="2026-01-01T00:00:00Z",
    )
    raw = {
        "user_id": "user-1", "project_id": "project-1",
        "recording_id": "recording-2",
        "key": "users/user-1/projects/project-1/recordings/recording-2/transcript.json",
        "payload_type": PayloadType.TRANSCRIPT.value,
        "content_type": "application/json",
    }
    with pytest.raises(OwnershipViolationError):
        SpeakUpPayloadStore._payload_ref_for_recording(
            raw, recording, expected_payload_type=PayloadType.TRANSCRIPT
        )


def test_stored_reference_must_match_requested_payload_slot():
    from src.aws_payload.service import SpeakUpPayloadStore

    recording = Recording(
        user_id="user-1", project_id="project-1", recording_id="recording-1",
        created_at="2026-01-01T00:00:00Z", updated_at="2026-01-01T00:00:00Z",
    )
    raw = {
        "user_id": "user-1", "project_id": "project-1", "recording_id": "recording-1",
        "key": "users/user-1/projects/project-1/recordings/recording-1/artifacts/a/1/report.json",
        "payload_type": PayloadType.PREPROCESS_REPORT.value,
        "content_type": "application/json",
    }
    with pytest.raises(OwnershipViolationError):
        SpeakUpPayloadStore._payload_ref_for_recording(
            raw, recording, expected_payload_type=PayloadType.TRANSCRIPT
        )


@pytest.mark.parametrize("field,value", [
    ("content_type", "audio/wav"),
    ("producer", "other-producer"),
    ("key", "users/user-1/projects/project-1/recordings/recording-1/artifacts/speakup-coach/v1/feedback.json"),
])
def test_stored_reference_must_match_artifact_identity(field, value):
    from src.aws_payload.service import SpeakUpPayloadStore

    recording = Recording(
        user_id="user-1", project_id="project-1", recording_id="recording-1",
        created_at="2026-01-01T00:00:00Z", updated_at="2026-01-01T00:00:00Z",
    )
    raw = {
        "user_id": recording.user_id, "project_id": recording.project_id,
        "recording_id": recording.recording_id,
        "key": "users/user-1/projects/project-1/recordings/recording-1/artifacts/speakup-coach/v1/feedback.json",
        "payload_type": PayloadType.FEEDBACK.value,
        "content_type": "application/json",
        "producer": "speakup-coach", "producer_version": "v1",
    }
    if field == "key":
        value = value.replace("feedback.json", "transcript.json")
    raw[field] = value
    with pytest.raises(OwnershipViolationError):
        SpeakUpPayloadStore._payload_ref_for_recording(
            raw, recording, expected_payload_type=PayloadType.FEEDBACK
        )
from src.aws_payload.serialization import (
    dumps_canonical_json,
    loads_json_object,
    make_envelope,
)


def config() -> PayloadConfig:
    return PayloadConfig(
        region="us-east-2",
        data_bucket="speakup-test-private",
        projects_table="speakup-test-projects",
        recordings_table="speakup-test-recordings",
    )


def test_config_reads_non_secret_environment():
    result = PayloadConfig.from_environment(
        {
            "AWS_REGION": "us-east-2",
            "DATA_BUCKET": "speakup-test-private",
            "PROJECTS_TABLE": "speakup-test-projects",
            "RECORDINGS_TABLE": "speakup-test-recordings",
        }
    )
    assert result.region == "us-east-2"
    assert result.max_json_payload_bytes == 1_048_576


def test_keys_are_owner_scoped_and_backend_generated():
    key = original_audio_key("user-1", "project-1", "recording-1", "audio/wav")
    assert key == (
        "users/user-1/projects/project-1/recordings/recording-1/original.wav"
    )
    assert require_owned_key(key, "user-1", "project-1", "recording-1") == key
    assert owner_project_id("user-1", "project-1") == (
        "USER#user-1#PROJECT#project-1"
    )


def test_keys_reject_traversal_and_cross_owner_access():
    with pytest.raises(IdentifierValidationError):
        artifact_key(
            "user-1",
            "project-1",
            "recording-1",
            producer="../escape",
            producer_version="1",
            artifact_name="report",
            content_type="application/json",
        )
    with pytest.raises(OwnershipViolationError):
        require_owned_key(
            "users/other/projects/project-1/recordings/recording-1/original.wav",
            "user-1",
            "project-1",
            "recording-1",
        )


def test_canonical_json_round_trip_and_envelope_validation():
    envelope = make_envelope(
        PayloadType.SPEECH_ANALYSIS,
        producer="analyzer",
        producer_version="1.0.0",
        created_at="2026-10-27T12:00:00.000Z",
        data={"wpm": 132, "fillers": ["um"]},
    )
    encoded = dumps_canonical_json(envelope, 10_000)
    assert encoded == dumps_canonical_json(json.loads(encoded), 10_000)
    decoded = loads_json_object(
        encoded, 10_000, expected_payload_type=PayloadType.SPEECH_ANALYSIS
    )
    assert decoded["data"]["wpm"] == 132


def test_json_rejects_duplicates_nonfinite_depth_and_size():
    with pytest.raises(JsonValidationError):
        loads_json_object(b'{"a":1,"a":2}', 100)
    with pytest.raises(JsonValidationError):
        loads_json_object(b'{"a":NaN}', 100)
    nested = value = {}
    for _ in range(34):
        value["next"] = {}
        value = value["next"]
    with pytest.raises(JsonValidationError):
        dumps_canonical_json(nested, 10_000)
    with pytest.raises(PayloadTooLargeError):
        dumps_canonical_json({"value": "large"}, 3)
