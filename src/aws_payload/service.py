"""Owner-checking facade for SpeakUp's S3 and DynamoDB payload backends."""

from __future__ import annotations

from contextlib import AbstractContextManager
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
from typing import Any, BinaryIO, Mapping
import uuid

from src.aws_payload.config import PayloadConfig
from src.aws_payload.errors import PayloadValidationError
from src.aws_payload.factory import AwsClientFactory
from src.aws_payload.keys import validate_identifier
from src.aws_payload.models import (
    PayloadRef,
    PayloadType,
    Project,
    Recording,
    RecordingStatus,
    UploadIntent,
)
from src.aws_payload.repositories import (
    ProjectRepository,
    RecordingRepository,
    RepositoryPage,
)
from src.aws_payload.s3_store import S3PayloadStore
from src.aws_payload.serialization import make_envelope


def utc_timestamp() -> str:
    """Return the API's lexically sortable UTC timestamp format."""

    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


class SpeakUpPayloadStore:
    """Internal API that enforces ownership before every payload operation."""

    def __init__(
        self,
        config: PayloadConfig,
        *,
        factory: AwsClientFactory | None = None,
        projects: ProjectRepository | None = None,
        recordings: RecordingRepository | None = None,
        objects: S3PayloadStore | None = None,
    ) -> None:
        self.config = config
        self.factory = factory or AwsClientFactory(config)
        self.projects = projects or ProjectRepository(self.factory.projects_table)
        self.recordings = recordings or RecordingRepository(
            self.factory.recordings_table,
            self.factory.projects_table,
            transaction_client=self.factory.dynamodb_resource.meta.client,
            index_name=config.owner_project_index,
            recovery_days=config.recovery_days,
        )
        self.objects = objects or S3PayloadStore(config, self.factory.s3_client)

    @classmethod
    def from_environment(cls) -> "SpeakUpPayloadStore":
        """Build the backend API from Lambda or local environment variables."""

        return cls(PayloadConfig.from_environment())

    def create_project(
        self,
        user_id: str,
        *,
        project_title: str,
        description: str = "",
        project_id: str | None = None,
    ) -> Project:
        """Create one owner-scoped project without derived recording counters."""

        user = validate_identifier(user_id, "user_id")
        project = validate_identifier(project_id or str(uuid.uuid4()), "project_id")
        title = str(project_title).strip()[:200] or "Untitled project"
        detail = str(description)[:2000]
        now = utc_timestamp()
        record = Project(user, project, title, detail, now, now)
        return Project.from_item(self.projects.create(record.as_item()))

    def get_project(self, user_id: str, project_id: str) -> Project:
        """Return a project only from the authenticated owner's partition."""

        validate_identifier(user_id, "user_id")
        validate_identifier(project_id, "project_id")
        return Project.from_item(self.projects.get(user_id, project_id))

    def list_projects(
        self, user_id: str, *, limit: int = 50, cursor: str | None = None
    ) -> RepositoryPage[Project]:
        """List one owner's projects using the base-table partition key."""

        validate_identifier(user_id, "user_id")
        page = self.projects.list(user_id, limit=limit, cursor=cursor)
        return RepositoryPage(
            tuple(Project.from_item(item) for item in page.items), page.next_cursor
        )

    def reserve_upload(
        self,
        user_id: str,
        project_id: str,
        content_type: str,
        *,
        idempotency_key: str,
        recording_id: str | None = None,
        source_sha256: str | None = None,
    ) -> tuple[Recording, UploadIntent]:
        """Create metadata transactionally and return its short-lived upload URL."""

        self.get_project(user_id, project_id)
        if not isinstance(idempotency_key, str) or not 1 <= len(idempotency_key) <= 36:
            raise PayloadValidationError("idempotency_key must contain 1-36 characters")
        if not all(
            character.isalnum() or character in "-_"
            for character in idempotency_key
        ):
            raise PayloadValidationError(
                "idempotency_key contains unsupported characters"
            )
        derived_id = str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"speakup:{user_id}:{project_id}:{idempotency_key}",
            )
        )
        recording_value = validate_identifier(
            recording_id or derived_id, "recording_id"
        )
        intent = self.objects.create_upload_intent(
            user_id, project_id, recording_value, content_type, source_sha256
        )
        now = utc_timestamp()
        record = Recording(
            user_id=user_id,
            project_id=project_id,
            recording_id=recording_value,
            created_at=now,
            updated_at=now,
            content_type=content_type,
            original_s3_key=intent.key,
            source_sha256=source_sha256,
        )
        fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "user_id": user_id,
                    "project_id": project_id,
                    "recording_id": recording_value,
                    "content_type": content_type,
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        stored = self.recordings.create(
            record.as_item(),
            idempotency_key=idempotency_key,
            idempotency_fingerprint=fingerprint,
        )
        return Recording.from_item(stored), intent

    def confirm_upload(self, user_id: str, recording_id: str) -> Recording:
        """Verify S3 metadata and transition a reservation to UPLOADED once."""

        item = self.recordings.get(user_id, recording_id)
        recording = Recording.from_item(item)
        if recording.status is not RecordingStatus.AWAITING_UPLOAD:
            return recording
        reference = self.objects.confirm_original(
            user_id,
            recording.project_id,
            recording_id,
            recording.original_s3_key,
            recording.content_type,
            recording.source_sha256,
        )
        updated = self.recordings.transition(
            user_id,
            recording_id,
            RecordingStatus.UPLOADED.value,
            expected_revision=recording.revision,
            updated_at=utc_timestamp(),
            updates={
                "payload_refs": {PayloadType.ORIGINAL_AUDIO.value: reference.as_dict()},
                "content_length": reference.content_length,
                "original_etag": reference.etag or "",
                "source_sha256": recording.source_sha256 or reference.sha256 or "",
            },
        )
        return Recording.from_item(updated)

    def get_recording(self, user_id: str, recording_id: str) -> Recording:
        """Return a visible recording from the authenticated owner partition."""

        validate_identifier(user_id, "user_id")
        validate_identifier(recording_id, "recording_id")
        return Recording.from_item(self.recordings.get(user_id, recording_id))

    def list_recordings(
        self,
        user_id: str,
        project_id: str,
        *,
        limit: int = 50,
        cursor: str | None = None,
    ) -> RepositoryPage[Recording]:
        """List newest recordings through the owner-scoped project GSI."""

        self.get_project(user_id, project_id)
        page = self.recordings.list_for_project(
            user_id, project_id, limit=limit, cursor=cursor
        )
        return RepositoryPage(
            tuple(Recording.from_item(item) for item in page.items), page.next_cursor
        )

    def transition_recording(
        self,
        user_id: str,
        recording_id: str,
        to_status: RecordingStatus,
        *,
        expected_revision: int,
        updates: Mapping[str, Any] | None = None,
    ) -> Recording:
        """Apply a lifecycle transition with optimistic concurrency."""

        result = self.recordings.transition(
            user_id,
            recording_id,
            to_status.value,
            expected_revision=expected_revision,
            updated_at=utc_timestamp(),
            updates=updates,
        )
        return Recording.from_item(result)

    def put_json_artifact(
        self,
        user_id: str,
        recording_id: str,
        *,
        payload_type: PayloadType,
        producer: str,
        producer_version: str,
        artifact_name: str,
        data: Mapping[str, Any],
        expected_revision: int,
    ) -> tuple[Recording, PayloadRef]:
        """Persist canonical JSON then attach its compact reference to metadata."""

        recording = self.get_recording(user_id, recording_id)
        if recording.revision != expected_revision:
            from src.aws_payload.errors import WriteConflictError

            raise WriteConflictError("recording revision is stale")
        envelope = make_envelope(
            payload_type,
            producer=producer,
            producer_version=producer_version,
            data=data,
            created_at=recording.created_at,
        )
        reference = self.objects.put_json(
            user_id,
            recording.project_id,
            recording_id,
            payload_type=payload_type,
            producer=producer,
            producer_version=producer_version,
            artifact_name=artifact_name,
            document=envelope,
        )
        references = dict(recording.payload_refs)
        references[payload_type.value] = reference.as_dict()
        updated = self.recordings.patch(
            user_id,
            recording_id,
            expected_revision=expected_revision,
            updates={"payload_refs": references, "updated_at": utc_timestamp()},
        )
        return Recording.from_item(updated), reference

    def reconcile_json_artifact(
        self,
        user_id: str,
        recording_id: str,
        *,
        payload_type: PayloadType,
        producer: str,
        producer_version: str,
        artifact_name: str,
        expected_revision: int,
    ) -> tuple[Recording, PayloadRef] | None:
        """Attach an S3 artifact left behind by a previously interrupted write."""

        recording = self.get_recording(user_id, recording_id)
        reference = self.objects.find_json(
            user_id,
            recording.project_id,
            recording_id,
            payload_type=payload_type,
            producer=producer,
            producer_version=producer_version,
            artifact_name=artifact_name,
        )
        if reference is None:
            return None
        references = dict(recording.payload_refs)
        references[payload_type.value] = reference.as_dict()
        updated = self.recordings.patch(
            user_id,
            recording_id,
            expected_revision=expected_revision,
            updates={"payload_refs": references, "updated_at": utc_timestamp()},
        )
        return Recording.from_item(updated), reference

    def get_json_artifact(
        self, user_id: str, recording_id: str, payload_type: PayloadType
    ) -> dict[str, Any]:
        """Owner-check a recording before reading its selected JSON artifact."""

        recording = self.get_recording(user_id, recording_id)
        raw = recording.payload_refs.get(payload_type.value)
        if not isinstance(raw, Mapping):
            from src.aws_payload.errors import PayloadNotFoundError

            raise PayloadNotFoundError("Recording does not reference that payload")
        return self.objects.get_json(self._payload_ref(raw))

    def create_original_download_url(
        self, user_id: str, recording_id: str, *, expires_in: int | None = None
    ) -> str:
        """Return a short-lived GET URL only after a strong owner read."""

        recording = self.get_recording(user_id, recording_id)
        raw = recording.payload_refs.get(PayloadType.ORIGINAL_AUDIO.value)
        reference = (
            self._payload_ref(raw)
            if isinstance(raw, Mapping)
            else self.objects.confirm_original(
                user_id,
                recording.project_id,
                recording_id,
                recording.original_s3_key,
                recording.content_type,
            )
        )
        return self.objects.create_download_url(reference, expires_in=expires_in)

    def open_payload(
        self, user_id: str, recording_id: str, payload_type: PayloadType
    ) -> AbstractContextManager[BinaryIO]:
        """Owner-check and open a streaming payload for backend workflows."""

        recording = self.get_recording(user_id, recording_id)
        raw = recording.payload_refs.get(payload_type.value)
        if not isinstance(raw, Mapping):
            from src.aws_payload.errors import PayloadNotFoundError

            raise PayloadNotFoundError("Recording does not reference that payload")
        return self.objects.open_stream(self._payload_ref(raw))

    def download_payload(
        self,
        user_id: str,
        recording_id: str,
        payload_type: PayloadType,
        destination: str | Path,
    ) -> None:
        """Owner-check and download a selected payload for a backend workflow."""

        recording = self.get_recording(user_id, recording_id)
        raw = recording.payload_refs.get(payload_type.value)
        if not isinstance(raw, Mapping):
            from src.aws_payload.errors import PayloadNotFoundError

            raise PayloadNotFoundError("Recording does not reference that payload")
        self.objects.download_file(self._payload_ref(raw), destination)

    def soft_delete(
        self, user_id: str, recording_id: str, *, expected_revision: int
    ) -> Recording:
        """Hide a recording immediately while preserving its recovery window."""

        return Recording.from_item(
            self.recordings.soft_delete(
                user_id, recording_id, expected_revision=expected_revision
            )
        )

    def recover(
        self, user_id: str, recording_id: str, *, expected_revision: int
    ) -> Recording:
        """Restore a soft-deleted recording within the configured window."""

        return Recording.from_item(
            self.recordings.recover(
                user_id, recording_id, expected_revision=expected_revision
            )
        )

    def permanently_delete(
        self,
        user_id: str,
        recording_id: str,
        *,
        expected_revision: int,
        confirmation: str,
        purge_token: str,
    ) -> int:
        """Purge every S3 version, then conditionally remove DynamoDB metadata."""

        if confirmation != recording_id:
            raise PayloadValidationError(
                "Permanent deletion confirmation must equal recording_id"
            )
        current = self.recordings.get(user_id, recording_id, include_deleted=True)
        if current.get("status") == RecordingStatus.PURGE_PENDING.value:
            staged = current
            purge_token = str(current["purge_token"])
        else:
            staged = self.recordings.stage_permanent_delete(
                user_id,
                recording_id,
                expected_revision=expected_revision,
                purge_token=purge_token,
            )
        deleted = self.objects.purge_recording(
            user_id, str(current["project_id"]), recording_id
        )
        self.recordings.finalize_permanent_delete(
            user_id,
            recording_id,
            expected_revision=int(staged["revision"]),
            purge_token=purge_token,
        )
        return deleted

    def cleanup_expired_recording(
        self,
        user_id: str,
        recording_id: str,
        *,
        now: datetime | None = None,
    ) -> int | None:
        """Purge one abandoned/failed recording after the seven-day default."""

        current = self.recordings.get(user_id, recording_id, include_deleted=True)
        if current.get("status") not in {
            RecordingStatus.AWAITING_UPLOAD.value,
            RecordingStatus.FAILED.value,
        }:
            return None
        reference_time = datetime.fromisoformat(
            str(current.get("updated_at", current["created_at"])).replace(
                "Z", "+00:00"
            )
        )
        clock = now or datetime.now(timezone.utc)
        if reference_time > clock - timedelta(
            days=self.config.abandoned_retention_days
        ):
            return None
        deleted = self.recordings.soft_delete(
            user_id,
            recording_id,
            expected_revision=int(current.get("revision", 0)),
            now=clock,
        )
        token = str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"speakup-cleanup:{user_id}:{recording_id}",
            )
        )
        return self.permanently_delete(
            user_id,
            recording_id,
            expected_revision=int(deleted["revision"]),
            confirmation=recording_id,
            purge_token=token,
        )

    @staticmethod
    def _payload_ref(raw: Mapping[str, Any]) -> PayloadRef:
        return PayloadRef(
            user_id=str(raw["user_id"]),
            project_id=str(raw["project_id"]),
            recording_id=str(raw["recording_id"]),
            key=str(raw["key"]),
            payload_type=PayloadType(str(raw["payload_type"])),
            content_type=str(raw["content_type"]),
            content_length=int(raw.get("content_length", 0)),
            sha256=str(raw.get("sha256", "")),
            producer=str(raw.get("producer", "unknown")),
            producer_version=str(raw.get("producer_version", "0")),
            schema_version=int(raw.get("schema_version", 1)),
            etag=raw.get("etag"),
            version_id=raw.get("version_id"),
        )
