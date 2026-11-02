"""Private, owner-scoped S3 adapter for SpeakUp payload bytes."""

from __future__ import annotations

import base64
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
from pathlib import Path
from typing import Any, BinaryIO, Iterator, Mapping

from botocore.exceptions import ClientError

from src.aws_payload.config import PayloadConfig
from src.aws_payload.errors import (
    PayloadAlreadyExistsError,
    PayloadIntegrityError,
    PayloadNotFoundError,
    PayloadValidationError,
)
from src.aws_payload.keys import (
    artifact_key,
    original_audio_key,
    recording_prefix,
    require_owned_key,
)
from src.aws_payload.models import PayloadRef, PayloadType, UploadIntent
from src.aws_payload.serialization import dumps_canonical_json, loads_json_object


_AUDIO_TYPES = frozenset(
    {"audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/x-m4a"}
)


def _etag(response: Mapping[str, Any]) -> str | None:
    value = response.get("ETag")
    return str(value).strip('"') if value else None


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class S3PayloadStore:
    """Store only backend-generated keys inside one configured private bucket."""

    def __init__(self, config: PayloadConfig, client: Any) -> None:
        self.config = config
        self._client = client

    def create_upload_intent(
        self,
        user_id: str,
        project_id: str,
        recording_id: str,
        content_type: str,
    ) -> UploadIntent:
        """Create a conditional, SSE-S3 pre-signed PUT for original audio."""

        if content_type not in _AUDIO_TYPES:
            raise PayloadValidationError(
                "Original upload content type is not supported"
            )
        key = original_audio_key(user_id, project_id, recording_id, content_type)
        headers = (
            ("Content-Type", content_type),
            ("If-None-Match", "*"),
            ("x-amz-server-side-encryption", "AES256"),
            ("x-amz-meta-owner-id", user_id),
            ("x-amz-meta-project-id", project_id),
            ("x-amz-meta-recording-id", recording_id),
            ("x-amz-meta-payload-type", PayloadType.ORIGINAL_AUDIO.value),
        )
        url = self._client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self.config.data_bucket,
                "Key": key,
                "ContentType": content_type,
                "ServerSideEncryption": "AES256",
                "IfNoneMatch": "*",
                "Metadata": {
                    "owner-id": user_id,
                    "project-id": project_id,
                    "recording-id": recording_id,
                    "payload-type": PayloadType.ORIGINAL_AUDIO.value,
                },
            },
            ExpiresIn=self.config.upload_url_ttl_seconds,
        )
        expires = datetime.now(timezone.utc) + timedelta(
            seconds=self.config.upload_url_ttl_seconds
        )
        return UploadIntent(
            user_id=user_id,
            project_id=project_id,
            recording_id=recording_id,
            key=key,
            content_type=content_type,
            expires_at=expires.isoformat(timespec="seconds").replace("+00:00", "Z"),
            upload_url=url,
            required_headers=headers,
        )

    def confirm_original(
        self,
        user_id: str,
        project_id: str,
        recording_id: str,
        key: str,
        content_type: str,
    ) -> PayloadRef:
        """Verify a reserved original exists and return its immutable reference."""

        require_owned_key(key, user_id, project_id, recording_id)
        expected = original_audio_key(user_id, project_id, recording_id, content_type)
        if key != expected:
            raise PayloadValidationError("Uploaded object does not match reservation")
        head = self._head(key)
        actual_type = str(head.get("ContentType", ""))
        if actual_type != content_type:
            raise PayloadIntegrityError(
                "Uploaded content type does not match reservation"
            )
        metadata = head.get("Metadata", {})
        return PayloadRef(
            user_id=user_id,
            project_id=project_id,
            recording_id=recording_id,
            key=key,
            payload_type=PayloadType.ORIGINAL_AUDIO,
            content_type=actual_type,
            content_length=int(head["ContentLength"]),
            sha256=str(metadata.get("sha256", "")),
            producer="client-upload",
            producer_version="1",
            etag=_etag(head),
            version_id=head.get("VersionId"),
        )

    def put_json(
        self,
        user_id: str,
        project_id: str,
        recording_id: str,
        *,
        payload_type: PayloadType,
        producer: str,
        producer_version: str,
        artifact_name: str,
        document: Mapping[str, Any],
    ) -> PayloadRef:
        """Write one immutable canonical JSON envelope with a SHA-256 checksum."""

        limit = (
            self.config.max_transcript_payload_bytes
            if payload_type is PayloadType.TRANSCRIPT
            else self.config.max_json_payload_bytes
        )
        encoded = dumps_canonical_json(document, limit)
        digest = hashlib.sha256(encoded).hexdigest()
        checksum = base64.b64encode(bytes.fromhex(digest)).decode("ascii")
        key = artifact_key(
            user_id,
            project_id,
            recording_id,
            producer=producer,
            producer_version=producer_version,
            artifact_name=artifact_name,
            content_type="application/json",
        )
        try:
            response = self._client.put_object(
                Bucket=self.config.data_bucket,
                Key=key,
                Body=encoded,
                ContentType="application/json",
                ServerSideEncryption="AES256",
                ChecksumSHA256=checksum,
                IfNoneMatch="*",
                Metadata={
                    "sha256": digest,
                    "payload-type": payload_type.value,
                    "producer": producer,
                    "producer-version": producer_version,
                    "recording-id": recording_id,
                },
            )
        except ClientError as error:
            code = error.response.get("Error", {}).get("Code")
            if code in {"PreconditionFailed", "ConditionalRequestConflict"}:
                existing = self._head(key)
                metadata = existing.get("Metadata", {})
                if (
                    metadata.get("sha256") == digest
                    and metadata.get("payload-type") == payload_type.value
                ):
                    return PayloadRef(
                        user_id=user_id,
                        project_id=project_id,
                        recording_id=recording_id,
                        key=key,
                        payload_type=payload_type,
                        content_type="application/json",
                        content_length=int(existing["ContentLength"]),
                        sha256=digest,
                        producer=producer,
                        producer_version=producer_version,
                        etag=_etag(existing),
                        version_id=existing.get("VersionId"),
                    )
                raise PayloadAlreadyExistsError(
                    "Immutable JSON payload already exists"
                ) from error
            raise
        return PayloadRef(
            user_id=user_id,
            project_id=project_id,
            recording_id=recording_id,
            key=key,
            payload_type=payload_type,
            content_type="application/json",
            content_length=len(encoded),
            sha256=digest,
            producer=producer,
            producer_version=producer_version,
            etag=_etag(response),
            version_id=response.get("VersionId"),
        )

    def put_file(
        self,
        source: str | Path,
        *,
        user_id: str,
        project_id: str,
        recording_id: str,
        payload_type: PayloadType,
        producer: str,
        producer_version: str,
        artifact_name: str,
        content_type: str,
    ) -> PayloadRef:
        """Upload one versioned artifact with managed multipart transfers."""

        if content_type not in _AUDIO_TYPES:
            raise PayloadValidationError("File artifact content type is not supported")
        path = Path(source)
        digest = _sha256_file(path)
        key = artifact_key(
            user_id,
            project_id,
            recording_id,
            producer=producer,
            producer_version=producer_version,
            artifact_name=artifact_name,
            content_type=content_type,
        )
        self._client.upload_file(
            str(path),
            self.config.data_bucket,
            key,
            ExtraArgs={
                "ContentType": content_type,
                "ServerSideEncryption": "AES256",
                "Metadata": {
                    "sha256": digest,
                    "payload-type": payload_type.value,
                    "producer": producer,
                    "producer-version": producer_version,
                    "recording-id": recording_id,
                },
            },
        )
        head = self._head(key)
        return PayloadRef(
            user_id=user_id,
            project_id=project_id,
            recording_id=recording_id,
            key=key,
            payload_type=payload_type,
            content_type=content_type,
            content_length=int(head["ContentLength"]),
            sha256=digest,
            producer=producer,
            producer_version=producer_version,
            etag=_etag(head),
            version_id=head.get("VersionId"),
        )

    def get_json(self, reference: PayloadRef) -> dict[str, Any]:
        """Read, bound, verify, and decode a canonical JSON payload."""

        self._validate_ref(reference)
        limit = (
            self.config.max_transcript_payload_bytes
            if reference.payload_type is PayloadType.TRANSCRIPT
            else self.config.max_json_payload_bytes
        )
        head = self._head(reference.key)
        if int(head["ContentLength"]) > limit:
            raise PayloadIntegrityError("Stored JSON exceeds its payload limit")
        with self.open_stream(reference) as body:
            raw = body.read(limit + 1)
        document = loads_json_object(
            raw, limit, expected_payload_type=reference.payload_type
        )
        digest = hashlib.sha256(raw).hexdigest()
        expected = reference.sha256 or head.get("Metadata", {}).get("sha256")
        if expected and digest != expected:
            raise PayloadIntegrityError("Stored JSON checksum does not match metadata")
        return document

    def find_json(
        self,
        user_id: str,
        project_id: str,
        recording_id: str,
        *,
        payload_type: PayloadType,
        producer: str,
        producer_version: str,
        artifact_name: str,
    ) -> PayloadRef | None:
        """Return an existing logical JSON artifact for retry reconciliation."""

        key = artifact_key(
            user_id,
            project_id,
            recording_id,
            producer=producer,
            producer_version=producer_version,
            artifact_name=artifact_name,
            content_type="application/json",
        )
        try:
            head = self._head(key)
        except PayloadNotFoundError:
            return None
        metadata = head.get("Metadata", {})
        if metadata.get("payload-type") != payload_type.value:
            raise PayloadIntegrityError("Existing JSON payload type is inconsistent")
        return PayloadRef(
            user_id=user_id,
            project_id=project_id,
            recording_id=recording_id,
            key=key,
            payload_type=payload_type,
            content_type="application/json",
            content_length=int(head["ContentLength"]),
            sha256=str(metadata.get("sha256", "")),
            producer=producer,
            producer_version=producer_version,
            etag=_etag(head),
            version_id=head.get("VersionId"),
        )

    @contextmanager
    def open_stream(self, reference: PayloadRef) -> Iterator[BinaryIO]:
        """Yield an S3 body and always release its HTTP connection."""

        self._validate_ref(reference)
        try:
            response = self._client.get_object(
                Bucket=self.config.data_bucket,
                Key=reference.key,
                **({"VersionId": reference.version_id} if reference.version_id else {}),
            )
        except ClientError as error:
            if self._is_missing(error):
                raise PayloadNotFoundError("Payload object not found") from error
            raise
        body = response["Body"]
        try:
            yield body
        finally:
            body.close()

    def download_file(self, reference: PayloadRef, destination: str | Path) -> None:
        """Download a payload using the SDK's managed transfer implementation."""

        self._validate_ref(reference)
        extra = {"VersionId": reference.version_id} if reference.version_id else None
        kwargs = {"ExtraArgs": extra} if extra else {}
        self._client.download_file(
            self.config.data_bucket, reference.key, str(destination), **kwargs
        )

    def create_download_url(
        self, reference: PayloadRef, *, expires_in: int | None = None
    ) -> str:
        """Sign a GET after the service layer has performed an owner check."""

        self._validate_ref(reference)
        ttl = expires_in or self.config.upload_url_ttl_seconds
        if not 60 <= ttl <= 3600:
            raise PayloadValidationError(
                "Download URL lifetime must be 60-3600 seconds"
            )
        params: dict[str, Any] = {
            "Bucket": self.config.data_bucket,
            "Key": reference.key,
        }
        if reference.version_id:
            params["VersionId"] = reference.version_id
        return self._client.generate_presigned_url(
            "get_object", Params=params, ExpiresIn=ttl
        )

    def purge_recording(self, user_id: str, project_id: str, recording_id: str) -> int:
        """Delete all versions and delete markers under one exact recording prefix."""

        prefix = recording_prefix(user_id, project_id, recording_id)
        paginator = self._client.get_paginator("list_object_versions")
        deleted = 0
        for page in paginator.paginate(Bucket=self.config.data_bucket, Prefix=prefix):
            objects: list[dict[str, str]] = []
            for entry in (*page.get("Versions", []), *page.get("DeleteMarkers", [])):
                key = str(entry["Key"])
                if not key.startswith(prefix):
                    raise PayloadIntegrityError(
                        "S3 returned an object outside purge scope"
                    )
                objects.append({"Key": key, "VersionId": str(entry["VersionId"])})
            for start in range(0, len(objects), 1000):
                batch = objects[start : start + 1000]
                if not batch:
                    continue
                response = self._client.delete_objects(
                    Bucket=self.config.data_bucket,
                    Delete={"Objects": batch, "Quiet": True},
                )
                errors = response.get("Errors", [])
                if errors:
                    raise PayloadIntegrityError(
                        "S3 did not delete every payload version"
                    )
                deleted += len(batch)
        return deleted

    def _head(self, key: str) -> Mapping[str, Any]:
        try:
            return self._client.head_object(Bucket=self.config.data_bucket, Key=key)
        except ClientError as error:
            if self._is_missing(error):
                raise PayloadNotFoundError("Payload object not found") from error
            raise

    def _validate_ref(self, reference: PayloadRef) -> None:
        require_owned_key(
            reference.key,
            reference.user_id,
            reference.project_id,
            reference.recording_id,
        )

    @staticmethod
    def _is_missing(error: ClientError) -> bool:
        code = error.response.get("Error", {}).get("Code")
        status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        return code in {"NoSuchKey", "NotFound", "404"} or status == 404
