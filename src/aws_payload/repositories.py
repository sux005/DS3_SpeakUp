"""Owner-scoped DynamoDB repositories for SpeakUp payload metadata.

The repositories deliberately expose domain-shaped operations instead of raw
``Table`` access.  This keeps table names, index keys, consistency choices, and
optimistic-lock conditions in one place and prevents callers from accidentally
querying across owners.
"""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Generic, Mapping, Protocol, Sequence, TypeVar

from boto3.dynamodb.conditions import Attr, Key

from src.aws_payload.errors import (
    IdempotencyConflictError,
    PayloadError,
    PayloadNotFoundError,
    PayloadValidationError,
    WriteConflictError,
)
from src.aws_payload.keys import created_at_recording_id, owner_project_id


OWNER_PROJECT_INDEX = "OwnerProjectCreatedAtIndex"
SCHEMA_VERSION = 1
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100
DEFAULT_RECOVERY_DAYS = 30
_FIELD_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
_PROTECTED_RECORDING_FIELDS = {
    "user_id",
    "recording_id",
    "project_id",
    "owner_project_id",
    "created_at_recording_id",
    "created_at",
    "revision",
    "schema_version",
    "status",
    "deleted_at",
    "recovery_until",
    "status_before_delete",
    "purge_token",
}


class TableLike(Protocol):
    """Subset of the boto3 DynamoDB Table interface used by repositories."""

    name: str
    meta: Any

    def get_item(self, **kwargs: Any) -> Mapping[str, Any]: ...

    def put_item(self, **kwargs: Any) -> Mapping[str, Any]: ...

    def query(self, **kwargs: Any) -> Mapping[str, Any]: ...

    def update_item(self, **kwargs: Any) -> Mapping[str, Any]: ...

    def delete_item(self, **kwargs: Any) -> Mapping[str, Any]: ...


class RepositoryError(PayloadError):
    """Base class for expected repository failures."""


class RecordNotFoundError(PayloadNotFoundError):
    """Raised when an owner-scoped project or recording does not exist."""


class RecordConflictError(WriteConflictError):
    """Raised when a conditional create collides with existing data."""


class RevisionConflictError(WriteConflictError):
    """Raised when an optimistic-lock revision no longer matches."""


class InvalidTransitionError(PayloadValidationError):
    """Raised when a recording lifecycle transition is not allowed."""


class InvalidCursorError(PayloadValidationError):
    """Raised when a pagination cursor is malformed or for another owner."""


class RecoveryExpiredError(PayloadValidationError):
    """Raised when a soft-deleted recording is outside its recovery window."""


T = TypeVar("T")


@dataclass(frozen=True)
class RepositoryPage(Generic[T]):
    """One stable page of repository records and an optional continuation."""

    items: tuple[T, ...]
    next_cursor: str | None = None


_ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "AWAITING_UPLOAD": frozenset({"UPLOADED", "FAILED"}),
    "UPLOADED": frozenset({"PROCESSING", "FAILED"}),
    "PROCESSING": frozenset({"TRANSCRIBING", "ANALYZED", "COMPLETE", "FAILED"}),
    "TRANSCRIBING": frozenset({"ANALYZED", "FAILED"}),
    "ANALYZED": frozenset({"COMPLETE", "FAILED"}),
    "FAILED": frozenset({"PROCESSING"}),
    "COMPLETE": frozenset(),
}


def owner_project_key(user_id: str, project_id: str) -> str:
    """Return the GSI partition key for one owner's project."""

    return owner_project_id(user_id, project_id)


def recording_created_key(created_at: str, recording_id: str) -> str:
    """Return the collision-safe chronological GSI sort key."""

    return created_at_recording_id(created_at, recording_id)


def utc_now() -> datetime:
    """Return an aware UTC clock value; isolated for deterministic tests."""

    return datetime.now(timezone.utc)


def format_timestamp(value: datetime) -> str:
    """Format a datetime as a lexically sortable UTC ISO-8601 timestamp."""

    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _parse_timestamp(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        raise RepositoryError("stored timestamp is invalid") from exc


def _normalise_project(item: Mapping[str, Any]) -> dict[str, Any]:
    result = dict(item)
    result["schema_version"] = int(result.get("schema_version", 0))
    result["revision"] = int(result.get("revision", 0))
    # Old project items may carry derived counters.  They are intentionally not
    # returned because the recordings table is the source of truth.
    result.pop("recording_count", None)
    result.pop("recording_ids", None)
    return result


def _normalise_recording(item: Mapping[str, Any]) -> dict[str, Any]:
    result = dict(item)
    result["schema_version"] = int(result.get("schema_version", 0))
    result["revision"] = int(result.get("revision", 0))
    result.setdefault("status", "AWAITING_UPLOAD")
    # Legacy artifacts remain readable while all new writes use payload refs.
    if "audio_s3_key" in result and "original_s3_key" not in result:
        result["original_s3_key"] = result["audio_s3_key"]
    return result


def _encode_cursor(scope: str, key: Mapping[str, Any]) -> str:
    envelope = {"v": 1, "scope": scope, "key": dict(key)}
    raw = json.dumps(envelope, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str | None, scope: str) -> dict[str, Any] | None:
    if cursor is None:
        return None
    if not isinstance(cursor, str) or not cursor or len(cursor) > 4096:
        raise InvalidCursorError("pagination cursor is invalid")
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        envelope = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InvalidCursorError("pagination cursor is invalid") from exc
    if (
        not isinstance(envelope, dict)
        or envelope.get("v") != 1
        or envelope.get("scope") != scope
        or not isinstance(envelope.get("key"), dict)
    ):
        raise InvalidCursorError("pagination cursor belongs to another query")
    key = envelope["key"]
    if not key or any(not isinstance(k, str) for k in key):
        raise InvalidCursorError("pagination cursor key is invalid")
    return key


def _page_size(value: int) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 1 <= value <= MAX_PAGE_SIZE
    ):
        raise ValueError(f"limit must be between 1 and {MAX_PAGE_SIZE}")
    return value


def _conditional_failure(exc: BaseException) -> bool:
    response = getattr(exc, "response", {})
    return response.get("Error", {}).get("Code") in {
        "ConditionalCheckFailedException",
        "TransactionCanceledException",
    }


class ProjectRepository:
    """Persist and list projects using the owner partition as the boundary."""

    def __init__(self, table: TableLike) -> None:
        self._table = table

    def create(self, project: Mapping[str, Any]) -> dict[str, Any]:
        """Create a project exactly once and return its canonical item."""

        item = dict(project)
        if not item.get("user_id") or not item.get("project_id"):
            raise ValueError("project requires user_id and project_id")
        item.pop("recording_count", None)
        item.pop("recording_ids", None)
        item.setdefault("schema_version", SCHEMA_VERSION)
        item.setdefault("revision", 0)
        try:
            self._table.put_item(
                Item=item,
                ConditionExpression=Attr("user_id").not_exists()
                & Attr("project_id").not_exists(),
            )
        except Exception as exc:
            if _conditional_failure(exc):
                raise RecordConflictError("project already exists") from exc
            raise
        return _normalise_project(item)

    def get(
        self, user_id: str, project_id: str, *, include_deleted: bool = False
    ) -> dict[str, Any]:
        """Read one owner-scoped project with strong consistency."""

        response = self._table.get_item(
            Key={"user_id": user_id, "project_id": project_id},
            ConsistentRead=True,
        )
        item = response.get("Item")
        if not item or (item.get("deleted_at") and not include_deleted):
            raise RecordNotFoundError("project not found")
        return _normalise_project(item)

    def list(
        self,
        user_id: str,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
    ) -> RepositoryPage[dict[str, Any]]:
        """List projects for exactly one owner without scanning the table."""

        limit = _page_size(limit)
        scope = f"projects:{user_id}"
        start_key = _decode_cursor(cursor, scope)
        params: dict[str, Any] = {
            "KeyConditionExpression": Key("user_id").eq(user_id),
            "FilterExpression": Attr("deleted_at").not_exists(),
            "Limit": limit,
            "ScanIndexForward": False,
            "ConsistentRead": True,
        }
        if start_key:
            params["ExclusiveStartKey"] = start_key
        response = self._table.query(**params)
        items = tuple(_normalise_project(item) for item in response.get("Items", ()))
        last_key = response.get("LastEvaluatedKey")
        return RepositoryPage(
            items, _encode_cursor(scope, last_key) if last_key else None
        )


class RecordingRepository:
    """Persist recording state with owner checks and optimistic revisions."""

    def __init__(
        self,
        recordings_table: TableLike,
        projects_table: TableLike,
        *,
        transaction_client: Any | None = None,
        index_name: str = OWNER_PROJECT_INDEX,
        recovery_days: int = DEFAULT_RECOVERY_DAYS,
    ) -> None:
        if recovery_days < 1:
            raise ValueError("recovery_days must be positive")
        self._recordings = recordings_table
        self._projects = projects_table
        self._client = transaction_client or recordings_table.meta.client
        self._index_name = index_name
        self._recovery_days = recovery_days

    def create(
        self,
        recording: Mapping[str, Any],
        *,
        idempotency_key: str,
        idempotency_fingerprint: str,
    ) -> dict[str, Any]:
        """Create a recording transactionally after verifying project ownership.

        A replay using the same recording ID, idempotency key, and fingerprint
        returns the existing record.  Reusing either identifier with different
        input is a conflict rather than an accidental duplicate upload.
        """

        item = dict(recording)
        required = ("user_id", "project_id", "recording_id", "created_at")
        if any(not item.get(field) for field in required):
            raise ValueError(f"recording requires {', '.join(required)}")
        if not idempotency_key or not idempotency_fingerprint:
            raise ValueError("idempotency key and fingerprint are required")
        item.update(
            {
                "owner_project_id": owner_project_key(
                    item["user_id"], item["project_id"]
                ),
                "created_at_recording_id": recording_created_key(
                    item["created_at"], item["recording_id"]
                ),
                "idempotency_key": idempotency_key,
                "idempotency_fingerprint": idempotency_fingerprint,
                "schema_version": SCHEMA_VERSION,
                "revision": 0,
            }
        )
        item.setdefault("status", "AWAITING_UPLOAD")
        try:
            self._client.transact_write_items(
                TransactItems=[
                    {
                        "ConditionCheck": {
                            "TableName": self._projects.name,
                            "Key": {
                                "user_id": item["user_id"],
                                "project_id": item["project_id"],
                            },
                            "ConditionExpression": (
                                "attribute_exists(user_id) AND "
                                "attribute_exists(project_id) AND "
                                "attribute_not_exists(deleted_at)"
                            ),
                        }
                    },
                    {
                        "Put": {
                            "TableName": self._recordings.name,
                            "Item": item,
                            "ConditionExpression": (
                                "attribute_not_exists(user_id) AND "
                                "attribute_not_exists(recording_id)"
                            ),
                        }
                    },
                ],
                ClientRequestToken=idempotency_key[:36],
            )
        except Exception as exc:
            if not _conditional_failure(exc):
                raise
            existing = self._get_optional(item["user_id"], item["recording_id"])
            if existing is None:
                raise RecordNotFoundError("project not found") from exc
            if (
                existing.get("idempotency_key") == idempotency_key
                and existing.get("idempotency_fingerprint")
                == idempotency_fingerprint
            ):
                return existing
            raise IdempotencyConflictError(
                "idempotency key was reused with different input"
            ) from exc
        return _normalise_recording(item)

    def _get_optional(self, user_id: str, recording_id: str) -> dict[str, Any] | None:
        response = self._recordings.get_item(
            Key={"user_id": user_id, "recording_id": recording_id},
            ConsistentRead=True,
        )
        item = response.get("Item")
        return _normalise_recording(item) if item else None

    def get(
        self, user_id: str, recording_id: str, *, include_deleted: bool = False
    ) -> dict[str, Any]:
        """Read a recording strongly and enforce the owner partition."""

        item = self._get_optional(user_id, recording_id)
        if item is None or (item.get("deleted_at") and not include_deleted):
            raise RecordNotFoundError("recording not found")
        return item

    def list_for_project(
        self,
        user_id: str,
        project_id: str,
        *,
        limit: int = DEFAULT_PAGE_SIZE,
        cursor: str | None = None,
    ) -> RepositoryPage[dict[str, Any]]:
        """List newest recordings through the owner-scoped GSI.

        Each GSI hit is re-read strongly from the base table.  This modest extra
        read cost prevents a recently deleted item from leaking through the
        eventually consistent index and supplies fields omitted by INCLUDE.
        """

        limit = _page_size(limit)
        owner_scope = owner_project_key(user_id, project_id)
        cursor_scope = f"recordings:{owner_scope}"
        start_key = _decode_cursor(cursor, cursor_scope)
        params: dict[str, Any] = {
            "IndexName": self._index_name,
            "KeyConditionExpression": Key("owner_project_id").eq(owner_scope),
            "Limit": limit,
            "ScanIndexForward": False,
        }
        if start_key:
            params["ExclusiveStartKey"] = start_key
        response = self._recordings.query(**params)
        items: list[dict[str, Any]] = []
        for projected in response.get("Items", ()):
            recording_id = projected.get("recording_id")
            if not recording_id:
                continue
            current = self._get_optional(user_id, recording_id)
            if (
                current
                and current.get("project_id") == project_id
                and not current.get("deleted_at")
                and current.get("status") not in {"DELETED", "PURGE_PENDING"}
            ):
                items.append(current)
        last_key = response.get("LastEvaluatedKey")
        return RepositoryPage(
            tuple(items),
            _encode_cursor(cursor_scope, last_key) if last_key else None,
        )

    def transition(
        self,
        user_id: str,
        recording_id: str,
        to_status: str,
        *,
        expected_revision: int,
        updated_at: str,
        updates: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Apply a validated status change under an optimistic revision lock."""

        current = self.get(user_id, recording_id)
        from_status = str(current["status"])
        if to_status not in _ALLOWED_TRANSITIONS.get(from_status, frozenset()):
            raise InvalidTransitionError(
                f"recording cannot transition from {from_status} to {to_status}"
            )
        return self._update_recording(
            current,
            expected_revision=expected_revision,
            set_values={
                "status": to_status,
                "updated_at": updated_at,
                **(updates or {}),
            },
        )

    def patch(
        self,
        user_id: str,
        recording_id: str,
        *,
        expected_revision: int,
        updates: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Update non-lifecycle metadata under the optimistic revision lock."""

        current = self.get(user_id, recording_id, include_deleted=True)
        if current.get("status") in {"DELETED", "PURGE_PENDING"}:
            raise InvalidTransitionError("deleted recording metadata is immutable")
        return self._update_recording(
            current,
            expected_revision=expected_revision,
            set_values=updates,
        )

    def soft_delete(
        self,
        user_id: str,
        recording_id: str,
        *,
        expected_revision: int,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        """Hide a recording and start its recoverable deletion window."""

        current = self.get(user_id, recording_id, include_deleted=True)
        if current.get("status") == "DELETED":
            return current
        if current.get("status") == "PURGE_PENDING":
            raise InvalidTransitionError("permanent deletion is already pending")
        clock = now or utc_now()
        return self._update_recording(
            current,
            expected_revision=expected_revision,
            set_values={
                "status": "DELETED",
                "status_before_delete": current["status"],
                "deleted_at": format_timestamp(clock),
                "recovery_until": format_timestamp(
                    clock + timedelta(days=self._recovery_days)
                ),
                "updated_at": format_timestamp(clock),
            },
            remove_fields=("owner_project_id", "created_at_recording_id"),
        )

    def recover(
        self,
        user_id: str,
        recording_id: str,
        *,
        expected_revision: int,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        """Restore a soft-deleted recording within its recovery window."""

        current = self.get(user_id, recording_id, include_deleted=True)
        if current.get("status") != "DELETED":
            raise InvalidTransitionError("recording is not recoverably deleted")
        clock = now or utc_now()
        if _parse_timestamp(current["recovery_until"]) < clock:
            raise RecoveryExpiredError("recording recovery window has expired")
        restored_status = str(current.get("status_before_delete") or "FAILED")
        return self._update_recording(
            current,
            expected_revision=expected_revision,
            set_values={
                "status": restored_status,
                "owner_project_id": owner_project_key(user_id, current["project_id"]),
                "created_at_recording_id": recording_created_key(
                    current["created_at"], recording_id
                ),
                "updated_at": format_timestamp(clock),
            },
            remove_fields=("deleted_at", "recovery_until", "status_before_delete"),
        )

    def stage_permanent_delete(
        self,
        user_id: str,
        recording_id: str,
        *,
        expected_revision: int,
        purge_token: str,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        """Mark a deleted recording for an idempotent S3 purge."""

        if not purge_token:
            raise ValueError("purge_token is required")
        current = self.get(user_id, recording_id, include_deleted=True)
        if current.get("status") == "PURGE_PENDING":
            if current.get("purge_token") == purge_token:
                return current
            raise RecordConflictError("a different permanent deletion is pending")
        if current.get("status") != "DELETED":
            raise InvalidTransitionError("recording must be soft-deleted first")
        clock = now or utc_now()
        return self._update_recording(
            current,
            expected_revision=expected_revision,
            set_values={
                "status": "PURGE_PENDING",
                "purge_token": purge_token,
                "purge_started_at": format_timestamp(clock),
                "updated_at": format_timestamp(clock),
            },
        )

    def finalize_permanent_delete(
        self,
        user_id: str,
        recording_id: str,
        *,
        expected_revision: int,
        purge_token: str,
    ) -> None:
        """Delete metadata after every S3 version has been purged."""

        try:
            self._recordings.delete_item(
                Key={"user_id": user_id, "recording_id": recording_id},
                ConditionExpression=(
                    Attr("status").eq("PURGE_PENDING")
                    & Attr("revision").eq(expected_revision)
                    & Attr("purge_token").eq(purge_token)
                ),
            )
        except Exception as exc:
            if _conditional_failure(exc):
                raise RevisionConflictError(
                    "recording changed before permanent deletion completed"
                ) from exc
            raise

    def _update_recording(
        self,
        current: Mapping[str, Any],
        *,
        expected_revision: int,
        set_values: Mapping[str, Any],
        remove_fields: Sequence[str] = (),
    ) -> dict[str, Any]:
        if int(current.get("revision", 0)) != expected_revision:
            raise RevisionConflictError("recording revision is stale")
        invalid = {
            field
            for field in set_values
            if field in _PROTECTED_RECORDING_FIELDS and field not in {"status"}
        }
        # Lifecycle methods need to update their protected bookkeeping fields;
        # ordinary callers only reach this helper through those methods.
        allowed_internal = {
            "updated_at",
            "deleted_at",
            "recovery_until",
            "status_before_delete",
            "owner_project_id",
            "created_at_recording_id",
            "purge_token",
            "purge_started_at",
        }
        invalid -= allowed_internal
        if invalid:
            raise ValueError(f"updates contain protected fields: {sorted(invalid)}")
        if any(not _FIELD_NAME.fullmatch(field) for field in set_values):
            raise ValueError("update field names must be simple identifiers")
        if any(not _FIELD_NAME.fullmatch(field) for field in remove_fields):
            raise ValueError("remove field names must be simple identifiers")

        names = {"#revision": "revision"}
        values: dict[str, Any] = {
            ":expected_revision": expected_revision,
            ":next_revision": expected_revision + 1,
        }
        setters = ["#revision = :next_revision"]
        for index, (field, value) in enumerate(set_values.items()):
            name = f"#set{index}"
            token = f":set{index}"
            names[name] = field
            values[token] = value
            setters.append(f"{name} = {token}")
        removers: list[str] = []
        for index, field in enumerate(remove_fields):
            name = f"#remove{index}"
            names[name] = field
            removers.append(name)
        update_expression = "SET " + ", ".join(setters)
        if removers:
            update_expression += " REMOVE " + ", ".join(removers)
        try:
            response = self._recordings.update_item(
                Key={
                    "user_id": current["user_id"],
                    "recording_id": current["recording_id"],
                },
                UpdateExpression=update_expression,
                ConditionExpression=(
                    Attr("user_id").exists()
                    & Attr("recording_id").exists()
                    & (
                        Attr("revision").eq(expected_revision)
                        | Attr("revision").not_exists()
                    )
                ),
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
                ReturnValues="ALL_NEW",
            )
        except Exception as exc:
            if _conditional_failure(exc):
                raise RevisionConflictError("recording revision is stale") from exc
            raise
        attributes = response.get("Attributes")
        if attributes:
            return _normalise_recording(attributes)
        merged = dict(current)
        merged.update(set_values)
        for field in remove_fields:
            merged.pop(field, None)
        merged["revision"] = expected_revision + 1
        return _normalise_recording(merged)


__all__ = [
    "DEFAULT_PAGE_SIZE",
    "DEFAULT_RECOVERY_DAYS",
    "IdempotencyConflictError",
    "InvalidCursorError",
    "InvalidTransitionError",
    "OWNER_PROJECT_INDEX",
    "ProjectRepository",
    "RecordConflictError",
    "RecordNotFoundError",
    "RecordingRepository",
    "RecoveryExpiredError",
    "RepositoryError",
    "RepositoryPage",
    "RevisionConflictError",
    "owner_project_key",
    "recording_created_key",
]
