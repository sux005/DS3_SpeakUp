"""EventBridge fallback for recordings whose processing workflow failed."""

from __future__ import annotations

from functools import lru_cache
from datetime import datetime, timedelta, timezone
import json
import os
import time
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.config import Config
from botocore.exceptions import ClientError

from src.aws_payload import RecordingStatus, SpeakUpPayloadStore
from src.aws_payload.errors import PayloadNotFoundError
from src.aws_payload.policy import ACTIVE_WORKFLOW_STATUSES


@lru_cache(maxsize=1)
def payloads() -> SpeakUpPayloadStore:
    """Build and reuse the owner-scoped payload store for warm invocations."""

    return SpeakUpPayloadStore.from_environment()


@lru_cache(maxsize=1)
def recordings_table() -> Any:
    """Return the metadata table used by the stale-workflow reconciler."""

    return boto3.resource("dynamodb").Table(os.environ["RECORDINGS_TABLE"])


def _maintenance_shards() -> int:
    return max(1, int(os.environ.get("MAINTENANCE_SHARD_COUNT", "8")))


def _maintenance_due_items(kind: str, *, limit: int) -> list[dict[str, Any]]:
    """Read due maintenance rows from the sparse index across all shards."""

    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    items: list[dict[str, Any]] = []
    table = recordings_table()
    index_name = os.environ.get("MAINTENANCE_INDEX_NAME", "MaintenanceDueIndex")
    per_shard = max(1, (limit + _maintenance_shards() - 1) // _maintenance_shards())
    for shard in range(_maintenance_shards()):
        if len(items) >= limit:
            break
        response = table.query(
            IndexName=index_name,
            KeyConditionExpression=(
                Key("maintenance_partition").eq(f"{kind}#{shard}")
                & Key("maintenance_due_at_recording_id").lte(now)
            ),
            Limit=min(per_shard, limit - len(items)),
            ScanIndexForward=True,
        )
        items.extend(item for item in response.get("Items", ()) if isinstance(item, dict))
    return items[:limit]


@lru_cache(maxsize=1)
def reconcile_cursor_table() -> Any:
    """Return the tiny table that stores the scan cursor between runs."""

    return boto3.resource("dynamodb").Table(os.environ["RECONCILE_CURSOR_TABLE"])


@lru_cache(maxsize=1)
def states_client() -> Any:
    """Return a Step Functions client for execution reconciliation."""

    return boto3.client(
        "stepfunctions",
        config=Config(
            retries={"total_max_attempts": 2, "mode": "standard"},
            connect_timeout=3,
            read_timeout=5,
        ),
    )


def _workflow_input(value: Any) -> tuple[str, str, str] | None:
    """Extract only the owner and recording identifiers from execution input."""

    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
    if not isinstance(value, dict):
        return None
    user_id = value.get("user_id")
    recording_id = value.get("recording_id")
    project_id = value.get("project_id")
    if not isinstance(user_id, str) or not user_id:
        return None
    if not isinstance(recording_id, str) or not recording_id:
        return None
    if not isinstance(project_id, str) or not project_id:
        return None
    return user_id, recording_id, project_id


def _recover_recording(
    user_id: str, recording_id: str, project_id: str | None = None,
    *, expected_execution_arn: str | None = None,
) -> None:
    """Conditionally mark an active recording failed, tolerating duplicate events."""

    store = payloads()
    try:
        recording = store.get_recording(user_id, recording_id)
    except PayloadNotFoundError:
        # The execution may outlive a user deletion. There is no metadata left
        # to repair, and the operational event remains safely logged below.
        return

    if recording.status not in {
        RecordingStatus.PROCESSING, RecordingStatus.TRANSCRIBING,
        RecordingStatus.ANALYZED,
    }:
        return
    if project_id is not None and getattr(recording, "project_id", None) != project_id:
        return
    persisted_arn = getattr(recording, "execution_arn", None)
    if expected_execution_arn and persisted_arn != expected_execution_arn:
        return

    try:
        store.transition_recording(
            user_id,
            recording_id,
            RecordingStatus.FAILED,
            expected_revision=recording.revision,
            updates={
                "failure_reason": "Workflow failed; terminal fallback recovery applied"
            },
        )
    except Exception:
        # A concurrent MarkFailed/fallback invocation may have won the write.
        # Re-read and suppress only that idempotent race; other failures must
        # propagate so EventBridge can retry the recovery event.
        current = store.get_recording(user_id, recording_id)
        if current.status is not RecordingStatus.FAILED:
            raise


def _stale_cutoff() -> datetime:
    """Return the UTC cutoff for records eligible for reconciliation."""

    minutes = int(os.environ.get("STALE_WORKFLOW_MINUTES", "30"))
    return datetime.now(timezone.utc) - timedelta(minutes=max(1, minutes))


def _is_stale(value: Any, cutoff: datetime) -> bool:
    if not isinstance(value, str):
        return True
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return True
    return timestamp < cutoff


def _record_reconcile_retry(cursor_table: Any, user_id: str, recording_id: str, error: str) -> None:
    """Persist a bounded retry marker so one failed record is observable."""

    marker = {
        "cursor_id": f"retry#{user_id}#{recording_id}",
        "user_id": user_id,
        "recording_id": recording_id,
        "error_code": error[:80],
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    try:
        cursor_table.put_item(Item=marker)
    except Exception:
        print(json.dumps({"event": "workflow_reconcile_retry_marker_failed", "user_id": user_id, "recording_id": recording_id}))
        raise
    print(json.dumps({"event": "workflow_reconcile_record_failed", "user_id": user_id, "recording_id": recording_id, "error_code": error[:80]}))


def _record_reconcile_candidate(
    cursor_table: Any,
    user_id: str,
    recording_id: str,
    maintenance_due_key: str | None = None,
) -> None:
    """Persist a stale active row for bounded execution-status processing."""

    marker = {
        "cursor_id": f"retry#{user_id}#{recording_id}",
        "user_id": user_id,
        "recording_id": recording_id,
        "candidate": True,
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    if isinstance(maintenance_due_key, str) and maintenance_due_key:
        marker["maintenance_due_at_recording_id"] = maintenance_due_key
    try:
        cursor_table.put_item(Item=marker)
    except Exception:
        print(json.dumps({"event": "workflow_reconcile_candidate_marker_failed", "user_id": user_id, "recording_id": recording_id}))
        raise


def _reschedule_workflow_candidate(marker: dict[str, Any], delay_seconds: int) -> None:
    """Move a still-active maintenance row forward without changing revision."""

    old_key = marker.get("maintenance_due_at_recording_id")
    user_id = marker.get("user_id")
    recording_id = marker.get("recording_id")
    if not all(isinstance(value, str) and value for value in (old_key, user_id, recording_id)):
        return
    table = recordings_table()
    current = table.get_item(
        Key={"user_id": user_id, "recording_id": recording_id},
        ConsistentRead=True,
    ).get("Item")
    if not isinstance(current, dict) or current.get("maintenance_due_at_recording_id") != old_key:
        return
    status = current.get("status")
    if status not in ACTIVE_WORKFLOW_STATUSES:
        return
    partition = current.get("maintenance_partition")
    if not isinstance(partition, str) or not partition.startswith("WORKFLOW#"):
        return
    due = datetime.now(timezone.utc) + timedelta(seconds=max(1, delay_seconds))
    new_key = f"{due.isoformat(timespec='seconds').replace('+00:00', 'Z')}#USER#{user_id}#RECORDING#{recording_id}"
    table.update_item(
        Key={"user_id": user_id, "recording_id": recording_id},
        UpdateExpression="SET maintenance_due_at_recording_id = :new_due",
        ConditionExpression=(
            "maintenance_due_at_recording_id = :old_due AND #status = :status"
        ),
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":new_due": new_key, ":old_due": old_key, ":status": status},
    )


def _retry_markers_page(cursor_table: Any) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Read one retry-marker page without mutating the scan cursor."""

    limit = max(1, int(os.environ.get("RECONCILE_RETRY_LIMIT", "25")))
    cursor_item = cursor_table.get_item(Key={"cursor_id": "retry-scan"}).get("Item")
    scan_kwargs: dict[str, Any] = {
        "FilterExpression": Attr("cursor_id").begins_with("retry#"),
        "Limit": limit,
    }
    if cursor_item and isinstance(cursor_item.get("last_key"), dict):
        scan_kwargs["ExclusiveStartKey"] = cursor_item["last_key"]
    try:
        response = cursor_table.scan(**scan_kwargs)
    except Exception as error:
        print(json.dumps({"event": "workflow_reconcile_retry_scan_failed", "error_code": type(error).__name__}))
        raise
    return (
        [item for item in response.get("Items", ()) if isinstance(item, dict)][:limit],
        response.get("LastEvaluatedKey"),
    )


def _retry_markers(cursor_table: Any) -> list[dict[str, Any]]:
    """Return a bounded batch and advance the cursor for compatibility callers."""

    markers, last_key = _retry_markers_page(cursor_table)
    if last_key:
        cursor_table.put_item(Item={"cursor_id": "retry-scan", "last_key": last_key})
    else:
        cursor_table.delete_item(Key={"cursor_id": "retry-scan"})
    return markers


def _process_retry_marker(cursor_table: Any, marker: dict[str, Any]) -> int:
    """Retry one marked record and remove its marker only when resolved."""

    user_id = marker.get("user_id")
    recording_id = marker.get("recording_id")
    marker_id = marker.get("cursor_id")
    if not all(isinstance(value, str) and value for value in (user_id, recording_id, marker_id)):
        return 0
    try:
        recording = payloads().get_recording(user_id, recording_id)
        status_value = getattr(recording.status, "value", recording.status)
        if status_value not in ACTIVE_WORKFLOW_STATUSES:
            cursor_table.delete_item(Key={"cursor_id": marker_id})
            return 0
        execution_arn = getattr(recording, "execution_arn", None)
        status = "MISSING"
        if execution_arn:
            try:
                status = states_client().describe_execution(executionArn=execution_arn).get("status")
            except ClientError as error:
                code = error.response.get("Error", {}).get("Code", "")
                if code not in {"ExecutionDoesNotExist", "ExecutionDoesNotExistException"}:
                    raise
                status = "MISSING"
            if status in {"RUNNING", "PENDING", "PENDING_REDRIVE"}:
                _reschedule_workflow_candidate(marker, int(os.environ.get("RECONCILE_RECHECK_SECONDS", "300")))
                return 0
        if status not in {"FAILED", "TIMED_OUT", "ABORTED", "MISSING"}:
            _reschedule_workflow_candidate(marker, int(os.environ.get("RECONCILE_RECHECK_SECONDS", "300")))
            return 0
        _recover_recording(user_id, recording_id)
        current = payloads().get_recording(user_id, recording_id)
        current_status = getattr(current.status, "value", current.status)
        if current_status not in ACTIVE_WORKFLOW_STATUSES:
            cursor_table.delete_item(Key={"cursor_id": marker_id})
            return 1
    except PayloadNotFoundError:
        cursor_table.delete_item(Key={"cursor_id": marker_id})
    except Exception as error:
        _record_reconcile_retry(cursor_table, user_id, recording_id, type(error).__name__)
    return 0


def _reconcile_stale_recordings() -> int:
    """Repair stale active recordings whose workflow is no longer running.

    The scan is deliberately bounded per invocation. EventBridge invokes this
    handler repeatedly, while an execution status lookup prevents an active
    workflow from being marked failed merely because its metadata is old.
    """

    cursor_table = reconcile_cursor_table()
    repaired = 0
    max_seconds = min(90, max(1, int(os.environ.get("RECONCILE_MAX_SECONDS", "90"))))
    deadline = time.monotonic() + max_seconds
    retry_markers, retry_cursor = _retry_markers_page(cursor_table)
    for marker in retry_markers:
        if time.monotonic() >= deadline:
            break
        repaired += _process_retry_marker(cursor_table, marker)
    else:
        if retry_cursor:
            cursor_table.put_item(Item={"cursor_id": "retry-scan", "last_key": retry_cursor})
        else:
            cursor_table.delete_item(Key={"cursor_id": "retry-scan"})
    if time.monotonic() >= deadline:
        return repaired

    discovery_mode = os.environ.get("MAINTENANCE_DISCOVERY_MODE", "legacy").lower()
    if discovery_mode in {"index", "dual"}:
        limit = max(1, int(os.environ.get("RECONCILE_SCAN_LIMIT", "100")))
        for item in _maintenance_due_items("WORKFLOW", limit=limit):
            user_id = item.get("user_id")
            recording_id = item.get("recording_id")
            if isinstance(user_id, str) and isinstance(recording_id, str):
                _record_reconcile_candidate(
                    cursor_table, user_id, recording_id,
                    item.get("maintenance_due_at_recording_id"),
                )
        if discovery_mode == "index":
            return repaired

    cursor_item = cursor_table.get_item(Key={"cursor_id": "recordings"}).get("Item")
    scan_kwargs: dict[str, Any] = {
        "Limit": max(1, int(os.environ.get("RECONCILE_SCAN_LIMIT", "100")))
    }
    if cursor_item and isinstance(cursor_item.get("last_key"), dict):
        scan_kwargs["ExclusiveStartKey"] = cursor_item["last_key"]
    response = recordings_table().scan(**scan_kwargs)
    cutoff = _stale_cutoff()
    active = ACTIVE_WORKFLOW_STATUSES
    for item in response.get("Items", ()):
        if item.get("status") not in active or not _is_stale(item.get("updated_at"), cutoff):
            continue
        user_id = item.get("user_id")
        recording_id = item.get("recording_id")
        if not isinstance(user_id, str) or not isinstance(recording_id, str):
            continue
        _record_reconcile_candidate(cursor_table, user_id, recording_id)
    last_key = response.get("LastEvaluatedKey")
    if last_key:
        cursor_table.put_item(
            Item={"cursor_id": "recordings", "last_key": last_key}
        )
    else:
        cursor_table.delete_item(Key={"cursor_id": "recordings"})
    return repaired


def handler(event: dict[str, Any], context: Any) -> dict[str, bool]:
    """Log safe execution identifiers and repair a nonterminal recording."""

    del context
    if event.get("action") == "reconcile":
        repaired = _reconcile_stale_recordings()
        print(json.dumps({"event": "workflow_reconciliation", "repaired": repaired}))
        return {"logged": True}
    detail = event.get("detail", {})
    if not isinstance(detail, dict):
        detail = {}
    identifiers = _workflow_input(detail.get("input"))
    execution_arn = detail.get("executionArn")
    if (
        detail.get("status") in {"FAILED", "TIMED_OUT", "ABORTED"}
        and identifiers is not None
        and isinstance(execution_arn, str)
        and execution_arn
    ):
        _recover_recording(
            *identifiers, expected_execution_arn=execution_arn
        )
    print(
        json.dumps(
            {
                "event": "workflow_failure",
                "status": detail.get("status"),
                "executionArn": detail.get("executionArn"),
                "stateMachineArn": detail.get("stateMachineArn"),
            }
        )
    )
    return {"logged": True}
