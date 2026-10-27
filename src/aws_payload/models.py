"""Typed domain records for the internal SpeakUp payload API."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Mapping


class PayloadType(StrEnum):
    """Versioned payload contracts stored under a recording."""

    ORIGINAL_AUDIO = "original-audio.v1"
    TRANSCRIPT = "transcript.v1"
    SPEECH_ANALYSIS = "speech-analysis.v1"
    FEEDBACK = "feedback.v1"
    ARTIFACT_MANIFEST = "artifact-manifest.v1"
    AUDIO_PREP_ARTIFACT = "audio-prep-artifact.v1"
    PREPROCESS_REPORT = "preprocess-report.v1"


class RecordingStatus(StrEnum):
    """Persisted recording lifecycle states."""

    AWAITING_UPLOAD = "AWAITING_UPLOAD"
    UPLOADED = "UPLOADED"
    PROCESSING = "PROCESSING"
    TRANSCRIBING = "TRANSCRIBING"
    ANALYZED = "ANALYZED"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"
    DELETED = "DELETED"
    PURGE_PENDING = "PURGE_PENDING"


@dataclass(frozen=True)
class PayloadRef:
    """Immutable metadata needed to locate and verify one S3 payload."""

    user_id: str
    project_id: str
    recording_id: str
    key: str
    payload_type: PayloadType
    content_type: str
    content_length: int
    sha256: str
    producer: str
    producer_version: str
    schema_version: int = 1
    etag: str | None = None
    version_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        """Return a JSON- and DynamoDB-compatible representation."""

        result = {
            "user_id": self.user_id,
            "project_id": self.project_id,
            "recording_id": self.recording_id,
            "key": self.key,
            "payload_type": self.payload_type.value,
            "content_type": self.content_type,
            "content_length": self.content_length,
            "sha256": self.sha256,
            "producer": self.producer,
            "producer_version": self.producer_version,
            "schema_version": self.schema_version,
        }
        if self.etag:
            result["etag"] = self.etag
        if self.version_id:
            result["version_id"] = self.version_id
        return result


@dataclass(frozen=True)
class UploadIntent:
    """Short-lived upload reservation returned to trusted backend callers."""

    user_id: str
    project_id: str
    recording_id: str
    key: str
    content_type: str
    expires_at: str
    upload_url: str
    required_headers: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class Project:
    """Owner-scoped project metadata."""

    user_id: str
    project_id: str
    project_title: str
    description: str
    created_at: str
    updated_at: str
    schema_version: int = 1
    revision: int = 0

    def as_item(self) -> dict[str, Any]:
        """Return the persisted representation without derived counters."""

        return dict(self.__dict__)

    @classmethod
    def from_item(cls, item: Mapping[str, Any]) -> "Project":
        """Read current or legacy project metadata."""

        return cls(
            user_id=str(item["user_id"]),
            project_id=str(item["project_id"]),
            project_title=str(item.get("project_title", "Untitled project")),
            description=str(item.get("description", "")),
            created_at=str(item.get("created_at", "")),
            updated_at=str(item.get("updated_at", item.get("created_at", ""))),
            schema_version=int(item.get("schema_version", 0)),
            revision=int(item.get("revision", 0)),
        )


@dataclass(frozen=True)
class Recording:
    """Owner-scoped recording state and compact S3 references."""

    user_id: str
    project_id: str
    recording_id: str
    created_at: str
    updated_at: str
    status: RecordingStatus = RecordingStatus.AWAITING_UPLOAD
    content_type: str = "audio/wav"
    original_s3_key: str = ""
    schema_version: int = 1
    revision: int = 0
    payload_refs: Mapping[str, Any] = field(default_factory=dict)
    source_sha256: str | None = None
    execution_arn: str | None = None
    execution_start_status: str | None = None

    def as_item(self) -> dict[str, Any]:
        """Return a DynamoDB-compatible representation."""

        result = {
            "user_id": self.user_id,
            "project_id": self.project_id,
            "recording_id": self.recording_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "status": self.status.value,
            "content_type": self.content_type,
            "original_s3_key": self.original_s3_key,
            "audio_s3_key": self.original_s3_key,
            "schema_version": self.schema_version,
            "revision": self.revision,
            "payload_refs": dict(self.payload_refs),
        }
        if self.source_sha256:
            result["source_sha256"] = self.source_sha256
        if self.execution_arn:
            result["execution_arn"] = self.execution_arn
        if self.execution_start_status:
            result["execution_start_status"] = self.execution_start_status
        return result

    @classmethod
    def from_item(cls, item: Mapping[str, Any]) -> "Recording":
        """Read current or legacy recording metadata."""

        raw_status = str(item.get("status", RecordingStatus.AWAITING_UPLOAD.value))
        if raw_status == "COMPLETED":
            raw_status = RecordingStatus.COMPLETE.value
        return cls(
            user_id=str(item["user_id"]),
            project_id=str(item["project_id"]),
            recording_id=str(item["recording_id"]),
            created_at=str(item.get("created_at", "")),
            updated_at=str(item.get("updated_at", item.get("created_at", ""))),
            status=RecordingStatus(raw_status),
            content_type=str(item.get("content_type", "audio/wav")),
            original_s3_key=str(
                item.get("original_s3_key", item.get("audio_s3_key", ""))
            ),
            schema_version=int(item.get("schema_version", 0)),
            revision=int(item.get("revision", 0)),
            payload_refs=item.get("payload_refs", {}),
            source_sha256=item.get("source_sha256"),
            execution_arn=item.get("execution_arn"),
            execution_start_status=item.get("execution_start_status"),
        )
