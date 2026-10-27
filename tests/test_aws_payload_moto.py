"""Selective cross-service emulator tests; install requirements-dev.txt to run."""

import boto3
import pytest


moto = pytest.importorskip("moto")

from src.aws_payload.config import PayloadConfig
from src.aws_payload.s3_store import S3PayloadStore


@moto.mock_aws
def test_permanent_purge_removes_all_versions_and_delete_markers():
    client = boto3.client("s3", region_name="us-east-2")
    client.create_bucket(
        Bucket="speakup-moto-private",
        CreateBucketConfiguration={"LocationConstraint": "us-east-2"},
    )
    client.put_bucket_versioning(
        Bucket="speakup-moto-private",
        VersioningConfiguration={"Status": "Enabled"},
    )
    key = "users/user-1/projects/project-1/recordings/recording-1/original.wav"
    client.put_object(Bucket="speakup-moto-private", Key=key, Body=b"one")
    client.put_object(Bucket="speakup-moto-private", Key=key, Body=b"two")
    client.delete_object(Bucket="speakup-moto-private", Key=key)
    store = S3PayloadStore(
        PayloadConfig(
            "us-east-2",
            "speakup-moto-private",
            "speakup-moto-projects",
            "speakup-moto-recordings",
        ),
        client,
    )
    assert store.purge_recording("user-1", "project-1", "recording-1") == 3
    versions = client.list_object_versions(
        Bucket="speakup-moto-private",
        Prefix="users/user-1/projects/project-1/recordings/recording-1/",
    )
    assert not versions.get("Versions")
    assert not versions.get("DeleteMarkers")
