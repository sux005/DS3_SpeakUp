import base64
import hashlib
import io
import json

import boto3
from botocore.response import StreamingBody
from botocore.stub import ANY, Stubber

from src.aws_payload.config import PayloadConfig
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
