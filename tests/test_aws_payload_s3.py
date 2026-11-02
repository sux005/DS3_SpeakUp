import base64
import hashlib
import io
import json
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import boto3
import pytest
from botocore.response import StreamingBody
from botocore.stub import ANY, Stubber
from botocore.exceptions import ClientError

from src.aws_payload.config import PayloadConfig
from src.aws_payload.errors import PayloadAlreadyExistsError, PayloadIntegrityError
from src.aws_payload.models import PayloadRef, PayloadType
from src.aws_payload.s3_store import S3PayloadStore
from src.aws_payload.serialization import make_envelope


def make_store():
    config = PayloadConfig(
        region="us-east-2",
        data_bucket="speakup-test-private",
        projects_table="speakup-test-projects",
        recordings_table="speakup-test-recordings",
    )
    client = boto3.client(
        "s3",
        region_name="us-east-2",
        aws_access_key_id="test",
        aws_secret_access_key="test",
    )
    return S3PayloadStore(config, client), client


def test_prepared_audio_is_written_once_and_conflicting_retry_is_rejected(tmp_path):
    store, _ = make_store()
    source = tmp_path / "prepared.wav"
    source.write_bytes(b"prepared audio")
    writes = []

    def put_object(**kwargs):
        writes.append(kwargs)
        assert kwargs["IfNoneMatch"] == "*"
        assert kwargs["ContentLength"] == len(b"prepared audio")
        return {"ETag": '"etag"', "VersionId": "v1"}

    store._client = SimpleNamespace(put_object=put_object)
    reference = store.put_file(
        source, user_id="user-1", project_id="project-1",
        recording_id="recording-1", payload_type=PayloadType.AUDIO_PREP_ARTIFACT,
        producer="audio-prep", producer_version="build-1",
        artifact_name="diagnostic", content_type="audio/wav",
    )
    assert reference.version_id == "v1"
    assert len(writes) == 1

    def conflict(**kwargs):
        raise ClientError({"Error": {"Code": "PreconditionFailed"}}, "PutObject")

    store._client = SimpleNamespace(
        put_object=conflict,
        head_object=lambda **kwargs: {
            "ContentLength": len(b"prepared audio"),
            "Metadata": {**writes[0]["Metadata"], "sha256": "different"},
        },
    )
    with pytest.raises(PayloadAlreadyExistsError):
        store.put_file(
            source, user_id="user-1", project_id="project-1",
            recording_id="recording-1", payload_type=PayloadType.AUDIO_PREP_ARTIFACT,
            producer="audio-prep", producer_version="build-1",
            artifact_name="diagnostic", content_type="audio/wav",
        )


def test_upload_presign_cryptographically_binds_content_length():
    store, _ = make_store()
    intent = store.create_upload_intent(
        "user-1", "project-1", "recording-1", "audio/wav",
        expected_content_length=5,
    )
    signed_headers = parse_qs(urlparse(intent.upload_url).query)["X-Amz-SignedHeaders"][0]
    assert "content-length" in signed_headers.split(";")


def test_original_upload_signs_and_verifies_full_sha256():
    store, _ = make_store()
    checksum = base64.b64encode(hashlib.sha256(b"audio bytes").digest()).decode("ascii")
    signed = []
    key = "users/user-1/projects/project-1/recordings/recording-1/original.wav"

    def presign(operation, **kwargs):
        signed.append((operation, kwargs))
        return "https://example.invalid/upload"

    def head_object(**kwargs):
        assert kwargs["ChecksumMode"] == "ENABLED"
        return {
            "ContentType": "audio/wav",
            "ContentLength": 11,
            "ChecksumSHA256": checksum,
            "Metadata": {},
        }

    store._client = SimpleNamespace(generate_presigned_url=presign, head_object=head_object)
    intent = store.create_upload_intent("user-1", "project-1", "recording-1", "audio/wav", checksum)
    assert signed[0][1]["Params"]["ChecksumSHA256"] == checksum
    assert dict(intent.required_headers)["x-amz-checksum-sha256"] == checksum
    reference = store.confirm_original("user-1", "project-1", "recording-1", key, "audio/wav", checksum)
    assert reference.sha256 == hashlib.sha256(b"audio bytes").hexdigest()

    store._client.head_object = lambda **kwargs: {**head_object(**kwargs), "ChecksumSHA256": "different"}
    with pytest.raises(PayloadIntegrityError):
        store.confirm_original("user-1", "project-1", "recording-1", key, "audio/wav", checksum)


def test_original_upload_reserves_and_confirms_expected_length():
    store, _ = make_store()
    signed = []
    key = "users/user-1/projects/project-1/recordings/recording-1/original.wav"

    store._client = SimpleNamespace(
        generate_presigned_url=lambda operation, **kwargs: signed.append(kwargs) or "url",
        head_object=lambda **kwargs: {
            "ContentType": "audio/wav",
            "ContentLength": 12,
            "Metadata": {},
        },
    )
    intent = store.create_upload_intent(
        "user-1", "project-1", "recording-1", "audio/wav", expected_content_length=12
    )
    assert intent.expected_content_length == 12
    assert signed[0]["Params"]["ContentLength"] == 12
    assert "Content-Length" not in dict(intent.required_headers)
    assert store.confirm_original(
        "user-1", "project-1", "recording-1", key, "audio/wav", expected_content_length=12
    ).content_length == 12

    with pytest.raises(PayloadIntegrityError):
        store.confirm_original(
            "user-1", "project-1", "recording-1", key, "audio/wav", expected_content_length=11
        )


@pytest.mark.parametrize(
    ("content_type", "extension"),
    [("audio/webm", "webm"), ("audio/ogg", "ogg")],
)
def test_browser_recording_uses_original_upload_and_confirmation(content_type, extension):
    store, _ = make_store()
    checksum = base64.b64encode(hashlib.sha256(b"recorded bytes").digest()).decode("ascii")
    signed = []

    def presign(operation, **kwargs):
        signed.append((operation, kwargs))
        return "https://example.invalid/upload"

    store._client = SimpleNamespace(
        generate_presigned_url=presign,
        head_object=lambda **kwargs: {
            "ContentType": content_type,
            "ContentLength": 14,
            "ChecksumSHA256": checksum,
            "Metadata": {},
        },
    )
    intent = store.create_upload_intent(
        "user-1", "project-1", "recording-1", content_type, checksum
    )
    assert intent.key.endswith(f"/original.{extension}")
    assert signed[0][1]["Params"]["ContentType"] == content_type
    reference = store.confirm_original(
        "user-1", "project-1", "recording-1", intent.key, content_type, checksum
    )
    assert reference.key == intent.key
    assert reference.sha256 == hashlib.sha256(b"recorded bytes").hexdigest()


def test_put_json_uses_sse_s3_checksum_and_conditional_creation():
    store, client = make_store()
    document = make_envelope(
        PayloadType.FEEDBACK,
        producer="coach",
        producer_version="1",
        created_at="2026-10-27T12:00:00.000Z",
        data={"feedback": "Pause after key points."},
    )
    encoded = json.dumps(
        document, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    digest = hashlib.sha256(encoded).digest()
    with Stubber(client) as stubber:
        stubber.add_response(
            "put_object",
            {"ETag": '"etag"', "VersionId": "version-1"},
            {
                "Bucket": "speakup-test-private",
                "Key": (
                    "users/user-1/projects/project-1/recordings/recording-1/"
                    "artifacts/coach/1/feedback.json"
                ),
                "Body": encoded,
                "ContentType": "application/json",
                "ServerSideEncryption": "AES256",
                "ChecksumSHA256": base64.b64encode(digest).decode("ascii"),
                "IfNoneMatch": "*",
                "Metadata": ANY,
            },
        )
        reference = store.put_json(
            "user-1",
            "project-1",
            "recording-1",
            payload_type=PayloadType.FEEDBACK,
            producer="coach",
            producer_version="1",
            artifact_name="feedback",
            document=document,
        )
    assert reference.etag == "etag"
    assert reference.version_id == "version-1"


def test_get_json_closes_stream_and_verifies_envelope():
    store, client = make_store()
    document = make_envelope(
        PayloadType.TRANSCRIPT,
        producer="normalizer",
        producer_version="1",
        created_at="2026-10-27T12:00:00.000Z",
        data={"text": "hello"},
    )
    raw = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
    body = StreamingBody(io.BytesIO(raw), len(raw))
    reference = PayloadRef(
        "user-1",
        "project-1",
        "recording-1",
        (
            "users/user-1/projects/project-1/recordings/recording-1/"
            "artifacts/normalizer/1/transcript.json"
        ),
        PayloadType.TRANSCRIPT,
        "application/json",
        len(raw),
        hashlib.sha256(raw).hexdigest(),
        "normalizer",
        "1",
    )
    with Stubber(client) as stubber:
        stubber.add_response(
            "head_object",
            {
                "ContentLength": len(raw),
                "ContentType": "application/json",
                "Metadata": {"sha256": reference.sha256},
            },
            {"Bucket": "speakup-test-private", "Key": reference.key},
        )
        stubber.add_response(
            "get_object",
            {"Body": body, "ContentLength": len(raw)},
            {"Bucket": "speakup-test-private", "Key": reference.key},
        )
        assert store.get_json(reference)["data"]["text"] == "hello"
    assert body._raw_stream.closed


def test_find_json_validates_identity_envelope_and_checksum():
    store, _ = make_store()
    document = make_envelope(
        PayloadType.FEEDBACK,
        producer="coach",
        producer_version="build-1",
        created_at="2026-10-27T12:00:00.000Z",
        data={"feedback": "pause"},
    )
    raw = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
    digest = hashlib.sha256(raw).hexdigest()
    body = StreamingBody(io.BytesIO(raw), len(raw))
    store._client = SimpleNamespace(
        head_object=lambda **kwargs: {
            "ContentLength": len(raw),
            "ContentType": "application/json",
            "Metadata": {
                "sha256": digest,
                "payload-type": PayloadType.FEEDBACK.value,
                "producer": "coach",
                "producer-version": "build-1",
            },
        },
        get_object=lambda **kwargs: {"Body": body, "ContentLength": len(raw)},
    )
    reference = store.find_json(
        "user-1", "project-1", "recording-1", payload_type=PayloadType.FEEDBACK,
        producer="coach", producer_version="build-1", artifact_name="feedback",
    )
    assert reference is not None
    assert reference.sha256 == digest


def test_find_json_rejects_wrong_identity_or_checksum():
    store, _ = make_store()
    document = make_envelope(
        PayloadType.FEEDBACK,
        producer="other",
        producer_version="build-1",
        created_at="2026-10-27T12:00:00.000Z",
        data={"feedback": "pause"},
    )
    raw = json.dumps(document, sort_keys=True, separators=(",", ":")).encode()
    store._client = SimpleNamespace(
        head_object=lambda **kwargs: {
            "ContentLength": len(raw),
            "Metadata": {
                "sha256": hashlib.sha256(raw).hexdigest(),
                "payload-type": PayloadType.FEEDBACK.value,
                "producer": "other",
                "producer-version": "build-1",
            },
        },
        get_object=lambda **kwargs: {
            "Body": StreamingBody(io.BytesIO(raw), len(raw)),
            "ContentLength": len(raw),
        },
    )
    with pytest.raises(PayloadIntegrityError):
        store.find_json(
            "user-1", "project-1", "recording-1", payload_type=PayloadType.FEEDBACK,
            producer="coach", producer_version="build-1", artifact_name="feedback",
        )


def test_purge_deletes_versions_and_delete_markers_under_exact_prefix():
    store, client = make_store()
    prefix = "users/user-1/projects/project-1/recordings/recording-1/"
    objects = [
        {"Key": prefix + "original.wav", "VersionId": "v1"},
        {"Key": prefix + "original.wav", "VersionId": "marker"},
    ]
    with Stubber(client) as stubber:
        stubber.add_response(
            "list_object_versions",
            {
                "IsTruncated": False,
                "Name": "speakup-test-private",
                "Prefix": prefix,
                "Versions": [objects[0]],
                "DeleteMarkers": [objects[1]],
            },
            {"Bucket": "speakup-test-private", "Prefix": prefix},
        )
        stubber.add_response(
            "delete_objects",
            {"Deleted": objects},
            {
                "Bucket": "speakup-test-private",
                "Delete": {"Objects": objects, "Quiet": True},
            },
        )
        assert store.purge_recording("user-1", "project-1", "recording-1") == 2
