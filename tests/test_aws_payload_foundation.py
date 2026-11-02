import json

import pytest

from src.aws_payload.config import PayloadConfig
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
from src.aws_payload.models import PayloadType
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
