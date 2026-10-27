"""Backfill the owner-scoped recording GSI attributes safely.

The command is dry-run by default. Pass ``--apply`` only after the new index is
ACTIVE and the dry-run totals have been reviewed. It never changes keys or
existing index values that disagree with the values derived from the base row.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import os
import sys
from typing import Any, Iterable

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


SELECTED_REGION = "us-east-2"


@dataclass
class BackfillResult:
    """Aggregate counters that avoid printing owner or recording identifiers."""

    scanned: int = 0
    already_current: int = 0
    eligible: int = 0
    updated: int = 0
    skipped_invalid: int = 0
    conflicts: int = 0


def index_values(item: dict[str, Any]) -> tuple[str, str] | None:
    """Return the approved GSI keys, or ``None`` for an incomplete legacy row."""

    required = ("user_id", "project_id", "recording_id", "created_at")
    if not all(isinstance(item.get(name), str) and item[name] for name in required):
        return None
    owner_project_id = (
        f"USER#{item['user_id']}#PROJECT#{item['project_id']}"
    )
    created_at_recording_id = (
        f"{item['created_at']}#RECORDING#{item['recording_id']}"
    )
    return owner_project_id, created_at_recording_id


def iter_recordings(table: Any, page_size: int) -> Iterable[dict[str, Any]]:
    """Yield only attributes needed to derive or verify the owner-scoped index."""

    paginator = table.meta.client.get_paginator("scan")
    pages = paginator.paginate(
        TableName=table.name,
        ProjectionExpression=(
            "user_id, project_id, recording_id, created_at, "
            "owner_project_id, created_at_recording_id"
        ),
        PaginationConfig={"PageSize": page_size},
    )
    for page in pages:
        yield from page.get("Items", [])


def backfill(table: Any, *, apply: bool, page_size: int = 100) -> BackfillResult:
    """Inspect every recording and conditionally add missing GSI attributes."""

    result = BackfillResult()
    for item in iter_recordings(table, page_size):
        result.scanned += 1
        values = index_values(item)
        if values is None:
            result.skipped_invalid += 1
            continue
        owner_project_id, created_at_recording_id = values
        current = (
            item.get("owner_project_id"),
            item.get("created_at_recording_id"),
        )
        if current == values:
            result.already_current += 1
            continue
        # Existing-but-different values need investigation; the backfill never
        # silently moves an item between owner/project partitions.
        if any(current):
            result.conflicts += 1
            continue
        result.eligible += 1
        if not apply:
            continue
        try:
            table.update_item(
                Key={
                    "user_id": item["user_id"],
                    "recording_id": item["recording_id"],
                },
                UpdateExpression=(
                    "SET owner_project_id=:owner, "
                    "created_at_recording_id=:created"
                ),
                ConditionExpression=(
                    "attribute_exists(user_id) AND attribute_exists(recording_id) "
                    "AND attribute_not_exists(owner_project_id) "
                    "AND attribute_not_exists(created_at_recording_id)"
                ),
                ExpressionAttributeValues={
                    ":owner": owner_project_id,
                    ":created": created_at_recording_id,
                },
            )
            result.updated += 1
        except table.meta.client.exceptions.ConditionalCheckFailedException:
            result.conflicts += 1
    return result


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Dry-run or apply the SpeakUp recording owner-index backfill."
        )
    )
    parser.add_argument("--table", required=True, help="Recordings table name")
    parser.add_argument(
        "--region",
        default=os.getenv("AWS_REGION", SELECTED_REGION),
        help=f"AWS selected Region; must be {SELECTED_REGION}",
    )
    parser.add_argument("--profile", help="Optional short-lived AWS CLI profile")
    parser.add_argument(
        "--page-size", type=int, default=100, choices=range(1, 1001)
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write missing attributes; omission performs a read-only dry-run",
    )
    return parser


def main() -> int:
    """Parse CLI arguments, run the backfill, and print non-sensitive totals."""

    parser = _parser()
    args = parser.parse_args()
    if args.region != SELECTED_REGION:
        parser.error(
            f"SpeakUp resources must remain in selected Region {SELECTED_REGION}"
        )
    session_kwargs: dict[str, str] = {"region_name": args.region}
    if args.profile:
        session_kwargs["profile_name"] = args.profile
    session = boto3.Session(**session_kwargs)
    sdk_config = Config(
        retries={"total_max_attempts": 3, "mode": "adaptive"},
        connect_timeout=5,
        read_timeout=30,
        user_agent_appid="speakup-owner-index-backfill/1.0",
    )
    table = session.resource("dynamodb", config=sdk_config).Table(args.table)
    try:
        result = backfill(table, apply=args.apply, page_size=args.page_size)
    except ClientError as exc:
        print(f"Backfill failed: {exc}", file=sys.stderr)
        return 1
    mode = "APPLY" if args.apply else "DRY-RUN"
    print(
        f"{mode}: scanned={result.scanned} eligible={result.eligible} "
        f"updated={result.updated} current={result.already_current} "
        f"invalid={result.skipped_invalid} conflicts={result.conflicts}"
    )
    return 0 if result.conflicts == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
