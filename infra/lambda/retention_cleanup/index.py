"""Bounded scheduled cleanup for expired recording metadata and S3 objects."""

from __future__ import annotations

from functools import lru_cache
from datetime import datetime, timedelta, timezone
import json
import os
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

from src.aws_payload import SpeakUpPayloadStore
from src.aws_payload.errors import PayloadNotFoundError


@lru_cache(maxsize=1)
def payloads() -> SpeakUpPayloadStore:
    return SpeakUpPayloadStore.from_environment()


@lru_cache(maxsize=1)
def recordings_table() -> Any:
    return boto3.resource("dynamodb").Table(os.environ["RECORDINGS_TABLE"])


@lru_cache(maxsize=1)
def cleanup_cursor_table() -> Any | None:
    name = os.environ.get("RECONCILE_CURSOR_TABLE", "").strip()
    return boto3.resource("dynamodb").Table(name) if name else None


def _maintenance_shards() -> int:
    return max(1, int(os.environ.get("MAINTENANCE_SHARD_COUNT", "8")))


def _due_cleanup_items(limit: int, start_shard: int = 0) -> tuple[list[dict[str, Any]], int]:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    index_name = os.environ.get("MAINTENANCE_INDEX_NAME", "MaintenanceDueIndex")
    table = recordings_table()
    items: list[dict[str, Any]] = []
    per_shard = max(1, (limit + _maintenance_shards() - 1) // _maintenance_shards())
    shard_count = _maintenance_shards()
    next_shard = start_shard % shard_count
    for offset in range(shard_count):
        shard = (start_shard + offset) % shard_count
        if len(items) >= limit:
            break
        response = table.query(
            IndexName=index_name,
            KeyConditionExpression=(
                Key("maintenance_partition").eq(f"CLEANUP#{shard}")
                & Key("maintenance_due_at_recording_id").lte(now)
            ),
            Limit=min(per_shard, limit - len(items)),
            ScanIndexForward=True,
        )
        items.extend(item for item in response.get("Items", ()) if isinstance(item, dict))
        next_shard = (shard + 1) % shard_count
        if len(items) >= limit:
            break
    return items[:limit], next_shard


def _start_shard() -> int:
    table = cleanup_cursor_table()
    if table is None:
        return 0
    item = table.get_item(Key={"cursor_id": "cleanup-shard"}).get("Item", {})
    try:
        return int(item.get("next_shard", 0)) % _maintenance_shards()
    except (TypeError, ValueError):
        return 0


def _save_start_shard(shard: int) -> None:
    table = cleanup_cursor_table()
    if table is not None:
        table.put_item(Item={"cursor_id": "cleanup-shard", "next_shard": int(shard)})


def _remaining_ms(context: Any) -> int | None:
    if context is None or not hasattr(context, "get_remaining_time_in_millis"):
        return None
    return int(context.get_remaining_time_in_millis())


def _reschedule_cleanup(item: dict[str, Any], delay_seconds: int) -> None:
    """Advance one due key after a strong reread, without changing revision."""

    user_id = item.get("user_id")
    recording_id = item.get("recording_id")
    old_key = item.get("maintenance_due_at_recording_id")
    if not all(isinstance(value, str) and value for value in (user_id, recording_id, old_key)):
        return
    table = recordings_table()
    current = table.get_item(
        Key={"user_id": user_id, "recording_id": recording_id},
        ConsistentRead=True,
    ).get("Item")
    if not isinstance(current, dict) or current.get("maintenance_due_at_recording_id") != old_key:
        return
    status = current.get("status")
    if status not in {"AWAITING_UPLOAD", "FAILED", "DELETED", "PURGE_PENDING"}:
        return
    partition = current.get("maintenance_partition")
    if not isinstance(partition, str) or not partition.startswith("CLEANUP#"):
        return
    due = datetime.now(timezone.utc) + timedelta(seconds=max(1, delay_seconds))
    new_key = f"{due.isoformat(timespec='seconds').replace('+00:00', 'Z')}#USER#{user_id}#RECORDING#{recording_id}"
    table.update_item(
        Key={"user_id": user_id, "recording_id": recording_id},
        UpdateExpression="SET maintenance_due_at_recording_id = :new_due",
        ConditionExpression="maintenance_due_at_recording_id = :old_due AND #status = :status",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={":new_due": new_key, ":old_due": old_key, ":status": status},
    )


def handler(event: dict[str, Any], context: Any) -> dict[str, int]:
    """Process a bounded due batch and propagate failures for scheduled retry."""

    del event
    limit = max(1, int(os.environ.get("CLEANUP_BATCH_LIMIT", "25")))
    safety_ms = max(250, int(os.environ.get("CLEANUP_MIN_REMAINING_MS", "5000")))
    items, next_shard = _due_cleanup_items(limit, _start_shard())
    _save_start_shard(next_shard)
    failures = 0
    cleaned = 0
    for item in items:
        remaining = _remaining_ms(context)
        if remaining is not None and remaining <= safety_ms:
            break
        user_id = item.get("user_id")
        recording_id = item.get("recording_id")
        if not isinstance(user_id, str) or not isinstance(recording_id, str):
            continue
        try:
            result = payloads().cleanup_expired_recording(user_id, recording_id)
            if result is not None:
                cleaned += 1
            else:
                _reschedule_cleanup(item, int(os.environ.get("CLEANUP_RECHECK_SECONDS", "600")))
        except PayloadNotFoundError:
            continue
        except Exception as error:
            failures += 1
            try:
                _reschedule_cleanup(item, int(os.environ.get("CLEANUP_RETRY_SECONDS", "600")))
            except Exception as reschedule_error:
                failures += 1
            print(json.dumps({
                "event": "recording_cleanup_failed",
                "user_id": user_id,
                "recording_id": recording_id,
                "error_code": type(error).__name__,
            }))
    if failures:
        raise RuntimeError(f"{failures} cleanup items failed")
    return {"cleaned": cleaned, "failed": failures}
