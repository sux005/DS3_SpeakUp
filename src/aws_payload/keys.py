"""Ownership-scoped key and index-value construction."""

from __future__ import annotations

import re

from src.aws_payload.errors import (
    IdentifierValidationError,
    OwnershipViolationError,
    PayloadValidationError,
)


_OPAQUE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_KEY_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$"
)
_CONTENT_TYPE_EXTENSIONS = {
    "application/json": "json",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-m4a": "m4a",
    "audio/x-wav": "wav",
}


def validate_identifier(value: str, name: str) -> str:
    """Return a safe opaque identifier or raise a domain validation error."""

    if not isinstance(value, str) or _OPAQUE_ID.fullmatch(value) is None:
        raise IdentifierValidationError(
            f"{name} must contain 1-64 letters, digits, underscores, or hyphens"
        )
    return value


def validate_key_segment(value: str, name: str) -> str:
    """Validate a backend-controlled artifact, producer, or version segment."""

    if (
        not isinstance(value, str)
        or _KEY_SEGMENT.fullmatch(value) is None
        or value in {".", ".."}
        or ".." in value
    ):
        raise IdentifierValidationError(f"{name} is not a safe storage-key segment")
    return value


def extension_for_content_type(content_type: str) -> str:
    """Return the single approved extension for an allowed media type."""

    normalized = content_type.strip().lower() if isinstance(content_type, str) else ""
    try:
        return _CONTENT_TYPE_EXTENSIONS[normalized]
    except KeyError as error:
        raise PayloadValidationError(
            f"Unsupported payload content type: {content_type!r}"
        ) from error


def recording_prefix(user_id: str, project_id: str, recording_id: str) -> str:
    """Return the only storage prefix permitted for one owned recording."""

    user = validate_identifier(user_id, "user_id")
    project = validate_identifier(project_id, "project_id")
    recording = validate_identifier(recording_id, "recording_id")
    return f"users/{user}/projects/{project}/recordings/{recording}/"


def original_audio_key(
    user_id: str,
    project_id: str,
    recording_id: str,
    content_type: str,
) -> str:
    """Build the immutable original-audio key for one recording."""

    extension = extension_for_content_type(content_type)
    if extension not in {"wav", "mp3", "m4a"}:
        raise PayloadValidationError("Original recording content type must be audio")
    return f"{recording_prefix(user_id, project_id, recording_id)}original.{extension}"


def artifact_key(
    user_id: str,
    project_id: str,
    recording_id: str,
    *,
    producer: str,
    producer_version: str,
    artifact_name: str,
    content_type: str,
) -> str:
    """Build a deterministic versioned key for a backend-owned artifact."""

    safe_producer = validate_key_segment(producer, "producer")
    safe_version = validate_key_segment(producer_version, "producer_version")
    safe_name = validate_key_segment(artifact_name, "artifact_name")
    extension = extension_for_content_type(content_type)
    return (
        f"{recording_prefix(user_id, project_id, recording_id)}"
        f"artifacts/{safe_producer}/{safe_version}/{safe_name}.{extension}"
    )


def legacy_preprocess_key(
    user_id: str,
    project_id: str,
    recording_id: str,
    *,
    pipeline_version: str,
    filename: str,
) -> str:
    """Build a read-compatible key for the existing preprocess layout."""

    version = validate_key_segment(pipeline_version, "pipeline_version")
    safe_filename = validate_key_segment(filename, "filename")
    return (
        f"{recording_prefix(user_id, project_id, recording_id)}"
        f"preprocess/{version}/{safe_filename}"
    )


def require_owned_key(
    key: str, user_id: str, project_id: str, recording_id: str
) -> str:
    """Return a key only when it belongs to the declared recording scope."""

    prefix = recording_prefix(user_id, project_id, recording_id)
    if not isinstance(key, str) or not key.startswith(prefix):
        raise OwnershipViolationError("Payload key is outside its recording scope")
    suffix = key[len(prefix) :]
    if not suffix or suffix.startswith("/") or "//" in suffix:
        raise OwnershipViolationError("Payload key has an invalid relative path")
    segments = suffix.split("/")
    if any(segment in {"", ".", ".."} for segment in segments):
        raise OwnershipViolationError("Payload key contains an unsafe path segment")
    is_original = re.fullmatch(r"original\.(?:wav|mp3|m4a)", suffix) is not None
    is_artifact = (
        re.fullmatch(
            r"artifacts/[A-Za-z0-9][A-Za-z0-9._-]{0,127}/"
            r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}/"
            r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:json|wav|mp3|m4a)",
            suffix,
        )
        is not None
    )
    is_legacy = (
        re.fullmatch(
            r"preprocess/[A-Za-z0-9][A-Za-z0-9._-]{0,127}/"
            r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}",
            suffix,
        )
        is not None
    )
    if not (is_original or is_artifact or is_legacy):
        raise OwnershipViolationError("Payload key does not match an approved layout")
    return key


def owner_project_id(user_id: str, project_id: str) -> str:
    """Build the owner-scoped partition key used by the recordings GSI."""

    user = validate_identifier(user_id, "user_id")
    project = validate_identifier(project_id, "project_id")
    return f"USER#{user}#PROJECT#{project}"


def created_at_recording_id(created_at: str, recording_id: str) -> str:
    """Build the chronological sort key used by the recordings GSI."""

    if not isinstance(created_at, str) or _TIMESTAMP.fullmatch(created_at) is None:
        raise PayloadValidationError("created_at must be an ISO-8601 UTC timestamp")
    recording = validate_identifier(recording_id, "recording_id")
    return f"{created_at}#RECORDING#{recording}"
