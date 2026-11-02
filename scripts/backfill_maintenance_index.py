"""Resumable maintenance-index and workflow-admission backfill.

The command is dry-run by default. It only adds missing sparse-index fields and
admission-set members; it never rewrites existing index values or removes data.
Use ``--apply`` only after ``MaintenanceDueIndex`` and the admissions table are
ACTIVE. A cursor item makes interrupted runs safe to resume.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import os
import sys
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from src.aws_payload.repositories import maintenance_values


SELECTED_REGION = "us-east-2"
CURSOR_ID = "maintenance-backfill"


@dataclass
class BackfillResult:
    scanned: int = 0
    indexed: int = 0
    admissions: int = 0
    already_current: int = 0
    skipped_invalid: int = 0
    conflicts: int = 0


def _valid_item(item: dict[str, Any]) -> bool:
    return all(isinstance(item.get(name), str) and item[name] for name in (
        "user_id", "recording_id", "status", "updated_at"
    ))


def _maintenance_values(
    item: dict[str, Any], *, recovery_days: int, stale_minutes: int,
    legacy_cleanup_grace_hours: int,
    migration_started_at: datetime,
) -> dict[str, str]:
    values = maintenance_values(
        str(item["user_id"]),
        str(item["recording_id"]),
        str(item["status"]),
        str(item["updated_at"]),
        recovery_until=item.get("recovery_until"),
        recovery_days=recovery_days,
        stale_minutes=stale_minutes,
    )
    if (
        values
        and item["status"] in {"AWAITING_UPLOAD", "FAILED"}
    ):
        due, separator, suffix = values["maintenance_due_at_recording_id"].partition("#RECORDING#")
        natural_due = datetime.fromisoformat(due.replace("Z", "+00:00"))
        migration_due = migration_started_at + timedelta(hours=legacy_cleanup_grace_hours)
        grace_due = max(natural_due, migration_due)
        values["maintenance_due_at_recording_id"] = (
            grace_due.isoformat(timespec="milliseconds").replace("+00:00", "Z")
            + separator + suffix
        )
    return values


def _scan_page(table: Any, page_size: int, start_key: dict[str, Any] | None) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Read one native-type scan page and expose its DynamoDB continuation key."""

    params: dict[str, Any] = {
        "Limit": page_size,
        "ProjectionExpression": (
            "user_id, recording_id, project_id, #status, #revision, updated_at, recovery_until, "
            "maintenance_partition, maintenance_due_at_recording_id"
        ),
        "ExpressionAttributeNames": {"#status": "status", "#revision": "revision"},
    }
    if start_key:
        params["ExclusiveStartKey"] = start_key
    response = table.scan(**params)
    return [item for item in response.get("Items", ()) if isinstance(item, dict)], response.get("LastEvaluatedKey")


def _transactional_active_backfill(recordings: Any, admissions: Any, item: dict[str, Any], values: dict[str, str]) -> None:
    """Add active maintenance and admission membership under one race check."""

    client = recordings.meta.client
    condition_error_names = {"ConditionalCheckFailedException", "TransactionCanceledException"}
    try:
        client.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": recordings.name,
                        "Key": {"user_id": item["user_id"], "recording_id": item["recording_id"]},
                        "UpdateExpression": "SET maintenance_partition=:partition, maintenance_due_at_recording_id=:due",
                        "ConditionExpression": (
                            "#status=:status AND "
                            + ("(#revision=:revision OR attribute_not_exists(#revision))" if item.get("revision", 0) == 0 else "#revision=:revision")
                        ),
                        "ExpressionAttributeNames": {"#status": "status", "#revision": "revision"},
                        "ExpressionAttributeValues": {
                            ":partition": values["maintenance_partition"], ":due": values["maintenance_due_at_recording_id"],
                            ":status": item["status"], ":revision": item.get("revision", 0),
                        },
                    }
                },
                {
                    "Update": {
                        "TableName": admissions.name,
                        "Key": {"user_id": item["user_id"]},
                        "UpdateExpression": "ADD active_recording_ids :ids SET updated_at=:updated",
                        "ExpressionAttributeValues": {
                            ":ids": {str(item["recording_id"])},
                            ":updated": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                        },
                    }
                },
            ]
        )
    except Exception as error:
        code = getattr(error, "response", {}).get("Error", {}).get("Code")
        if code in condition_error_names or type(error).__name__ in condition_error_names:
            raise RuntimeError("recording changed during maintenance backfill") from error
        raise


def backfill(
    recordings: Any,
    admissions: Any,
    cursor_table: Any,
    *,
    apply: bool,
    page_size: int = 100,
    recovery_days: int = 7,
    stale_minutes: int = 30,
    legacy_cleanup_grace_hours: int = 24,
    migration_started_at: datetime | None = None,
) -> BackfillResult:
    """Backfill one page when applying, or audit every page in dry-run mode."""

    result = BackfillResult()
    migration_clock = migration_started_at or datetime.now(timezone.utc)
    if migration_clock.tzinfo is None:
        migration_clock = migration_clock.replace(tzinfo=timezone.utc)
    else:
        migration_clock = migration_clock.astimezone(timezone.utc)
    cursor_item = cursor_table.get_item(Key={"cursor_id": CURSOR_ID}).get("Item") or {}
    start_key = (
        cursor_item.get("last_key")
        if apply and isinstance(cursor_item.get("last_key"), dict)
        else None
    )
    scan_state: dict[str, Any] = {"last_key": None}

    def iter_items():
        page_start = start_key
        while True:
            items, page_last_key = _scan_page(recordings, page_size, page_start)
            if not apply and page_last_key and page_last_key == page_start:
                raise RuntimeError("maintenance backfill scan cursor did not advance")
            scan_state["last_key"] = page_last_key
            yield from items
            if apply or not page_last_key:
                return
            page_start = page_last_key

    for item in iter_items():
        result.scanned += 1
        if not _valid_item(item):
            result.skipped_invalid += 1
            continue
        values = _maintenance_values(
            item, recovery_days=recovery_days, stale_minutes=stale_minutes,
            legacy_cleanup_grace_hours=legacy_cleanup_grace_hours,
            migration_started_at=migration_clock,
        )
        current = (item.get("maintenance_partition"), item.get("maintenance_due_at_recording_id"))
        expected = (values.get("maintenance_partition"), values.get("maintenance_due_at_recording_id"))
        active = item["status"] in {"PROCESSING", "TRANSCRIBING", "ANALYZED"}
        if active:
            if any(current) and current != expected:
                result.conflicts += 1
                continue
            if current != expected:
                result.indexed += 1
            if apply:
                try:
                    _transactional_active_backfill(recordings, admissions, item, values)
                except RuntimeError:
                    result.conflicts += 1
                    continue
            result.admissions += 1
            if current == expected:
                result.already_current += 1
            continue
        if current == expected:
            result.already_current += 1
            continue
        if any(current):
            result.conflicts += 1
            continue
        if not values:
            continue
        result.indexed += 1
        if apply:
            try:
                recordings.update_item(
                    Key={"user_id": item["user_id"], "recording_id": item["recording_id"]},
                    UpdateExpression="SET maintenance_partition=:partition, maintenance_due_at_recording_id=:due",
                    ConditionExpression=(
                        "#status=:status AND "
                        + ("(#revision=:revision OR attribute_not_exists(#revision)) " if item.get("revision", 0) == 0 else "#revision=:revision ")
                        + "AND attribute_not_exists(maintenance_partition) "
                        "AND attribute_not_exists(maintenance_due_at_recording_id)"
                    ),
                    ExpressionAttributeNames={"#status": "status", "#revision": "revision"},
                    ExpressionAttributeValues={":partition": values["maintenance_partition"], ":due": values["maintenance_due_at_recording_id"], ":status": item["status"], ":revision": item.get("revision", 0)},
                )
            except recordings.meta.client.exceptions.ConditionalCheckFailedException:
                result.conflicts += 1
                continue
    last_key = scan_state["last_key"]
    if apply:
        if last_key:
            cursor_table.put_item(Item={"cursor_id": CURSOR_ID, "last_key": last_key})
        else:
            cursor_table.delete_item(Key={"cursor_id": CURSOR_ID})
    return result


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Backfill sparse maintenance keys and workflow admissions")
    parser.add_argument("--recordings-table", required=True)
    parser.add_argument("--admissions-table", required=True)
    parser.add_argument("--cursor-table", required=True)
    parser.add_argument("--region", default=os.getenv("AWS_REGION", SELECTED_REGION))
    parser.add_argument("--profile")
    parser.add_argument("--page-size", type=int, default=100, choices=range(1, 1001))
    parser.add_argument("--recovery-days", type=int, default=7, choices=range(1, 31))
    parser.add_argument("--stale-minutes", type=int, default=30, choices=range(1, 1441))
    parser.add_argument("--legacy-cleanup-grace-hours", type=int, default=24, choices=range(1, 169))
    parser.add_argument("--apply", action="store_true")
    return parser


def main() -> int:
    parser = _parser()
    args = parser.parse_args()
    if args.region != SELECTED_REGION:
        parser.error(f"SpeakUp resources must remain in selected Region {SELECTED_REGION}")
    session_kwargs: dict[str, str] = {"region_name": args.region}
    if args.profile:
        session_kwargs["profile_name"] = args.profile
    sdk = Config(retries={"total_max_attempts": 3, "mode": "adaptive"}, connect_timeout=5, read_timeout=30, user_agent_appid="speakup-maintenance-backfill/1.0")
    session = boto3.Session(**session_kwargs)
    dynamodb = session.resource("dynamodb", config=sdk)
    try:
        result = backfill(
            dynamodb.Table(args.recordings_table),
            dynamodb.Table(args.admissions_table),
            dynamodb.Table(args.cursor_table),
            apply=args.apply,
            page_size=args.page_size,
            recovery_days=args.recovery_days,
            stale_minutes=args.stale_minutes,
            legacy_cleanup_grace_hours=args.legacy_cleanup_grace_hours,
            migration_started_at=datetime.now(timezone.utc),
        )
    except ClientError as error:
        print(f"Backfill failed: {error}", file=sys.stderr)
        return 1
    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"{mode}: scanned={result.scanned} indexed={result.indexed} admissions={result.admissions} current={result.already_current} invalid={result.skipped_invalid} conflicts={result.conflicts}")
    return 0 if result.conflicts == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
