"""Capture time-bounded AWS evidence for one SpeakUp workflow execution."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    raise TypeError(f"Unsupported JSON value: {type(value).__name__}")


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True, default=_json_default) + "\n",
        encoding="utf-8",
    )


def _history(stepfunctions: Any, execution_arn: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    token: str | None = None
    while True:
        request: dict[str, Any] = {
            "executionArn": execution_arn,
            "includeExecutionData": True,
            "maxResults": 1000,
        }
        if token:
            request["nextToken"] = token
        page = stepfunctions.get_execution_history(**request)
        events.extend(page.get("events", []))
        token = page.get("nextToken")
        if not token:
            return sorted(events, key=lambda event: int(event["id"]))


def _log_events(
    logs: Any,
    log_group: str,
    *,
    start_ms: int,
    end_ms: int,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    token: str | None = None
    while True:
        request: dict[str, Any] = {
            "logGroupName": log_group,
            "startTime": start_ms,
            "endTime": end_ms,
            "interleaved": True,
            "limit": 10_000,
        }
        if token:
            request["nextToken"] = token
        try:
            page = logs.filter_log_events(**request)
        except logs.exceptions.ResourceNotFoundException:
            return []
        events.extend(
            {
                "timestamp": event.get("timestamp"),
                "ingestion_time": event.get("ingestionTime"),
                "log_stream": event.get("logStreamName"),
                "message": event.get("message", ""),
            }
            for event in page.get("events", [])
        )
        next_token = page.get("nextToken")
        if not next_token or next_token == token:
            return events
        token = next_token


def capture(args: argparse.Namespace) -> Path:
    session = boto3.Session(
        profile_name=None if args.profile == "environment" else args.profile,
        region_name=args.region,
    )
    config = Config(retries={"mode": "standard", "max_attempts": 4})
    stepfunctions = session.client("stepfunctions", config=config)
    logs = session.client("logs", config=config)
    execution = stepfunctions.describe_execution(executionArn=args.execution_arn)
    start = execution["startDate"].astimezone(timezone.utc) - timedelta(minutes=2)
    stop_value = execution.get("stopDate") or datetime.now(timezone.utc)
    stop = stop_value.astimezone(timezone.utc) + timedelta(minutes=2)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    history = _history(stepfunctions, args.execution_arn)
    _write_json(args.output_dir / "step-functions-history.json", history)

    groups = [
        f"/aws/apigateway/{args.stack_name}",
        f"/aws/lambda/{args.stack_name}-api",
        f"/aws/lambda/{args.stack_name}-upload-trigger",
        f"/aws/lambda/{args.stack_name}-audio-prep",
        f"/aws/lambda/{args.stack_name}-processor",
        f"/aws/lambda/{args.stack_name}-workflow-failure",
        f"/aws/vendedlogs/states/{args.stack_name}-processing",
    ]
    counts: dict[str, int] = {}
    for group in groups:
        events = _log_events(
            logs,
            group,
            start_ms=int(start.timestamp() * 1000),
            end_ms=int(stop.timestamp() * 1000),
        )
        filename = group.strip("/").replace("/", "-") + ".json"
        _write_json(args.output_dir / filename, events)
        counts[group] = len(events)

    manifest = {
        "captured_at": datetime.now(timezone.utc),
        "execution_arn": args.execution_arn,
        "execution_status": execution["status"],
        "execution_start": execution["startDate"],
        "execution_stop": execution.get("stopDate"),
        "window_start": start,
        "window_stop": stop,
        "history_event_count": len(history),
        "cloudwatch_event_counts": counts,
        "runner_log": str(args.runner_log.resolve()) if args.runner_log else None,
        "privacy": "Audio bytes and transcript text are not copied into this evidence bundle.",
    }
    _write_json(args.output_dir / "manifest.json", manifest)
    return args.output_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("execution_arn")
    parser.add_argument("--profile", default="speakup-dev")
    parser.add_argument("--region", default="us-east-2")
    parser.add_argument("--stack-name", default="speakup-dev")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--runner-log", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        output = capture(args)
    except (ClientError, OSError, ValueError) as error:
        print(f"Evidence capture failed: {error}", file=sys.stderr)
        return 1
    print(f"Evidence bundle: {output.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
