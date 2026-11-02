"""Canonical JSON encoding and strict payload-envelope validation."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import math
from typing import Any, Mapping

from src.aws_payload.errors import JsonValidationError, PayloadTooLargeError
from src.aws_payload.models import PayloadType


MAX_JSON_DEPTH = 32


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise JsonValidationError(f"Duplicate JSON object key: {key}")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise JsonValidationError(f"Non-finite JSON number is not allowed: {value}")


def _validate_value(value: Any, depth: int = 0) -> None:
    if depth > MAX_JSON_DEPTH:
        raise JsonValidationError(f"JSON nesting exceeds {MAX_JSON_DEPTH} levels")
    if isinstance(value, float) and not math.isfinite(value):
        raise JsonValidationError("Non-finite JSON numbers are not allowed")
    if value is None or isinstance(value, (str, int, float, bool)):
        return
    if isinstance(value, Mapping):
        if any(not isinstance(key, str) for key in value):
            raise JsonValidationError("JSON object keys must be strings")
        for nested in value.values():
            _validate_value(nested, depth + 1)
        return
    if isinstance(value, (list, tuple)):
        for nested in value:
            _validate_value(nested, depth + 1)
        return
    raise JsonValidationError(f"Value is not JSON-compatible: {type(value).__name__}")


def dumps_canonical_json(document: Mapping[str, Any], max_bytes: int) -> bytes:
    """Encode a top-level object deterministically and enforce its byte limit."""

    if not isinstance(document, Mapping):
        raise JsonValidationError("JSON payload must be a top-level object")
    _validate_value(document)
    try:
        encoded = json.dumps(
            document,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise JsonValidationError("JSON payload is not serializable") from error
    if len(encoded) > max_bytes:
        raise PayloadTooLargeError(
            f"JSON payload is {len(encoded)} bytes; maximum is {max_bytes}"
        )
    return encoded


def loads_json_object(
    data: bytes | bytearray | memoryview,
    max_bytes: int,
    *,
    expected_payload_type: PayloadType | str | None = None,
) -> dict[str, Any]:
    """Decode strict UTF-8 JSON, rejecting duplicates and invalid envelopes."""

    raw = bytes(data)
    if len(raw) > max_bytes:
        raise PayloadTooLargeError(
            f"JSON payload is {len(raw)} bytes; maximum is {max_bytes}"
        )
    try:
        text = raw.decode("utf-8", errors="strict")
        document = json.loads(
            text,
            object_pairs_hook=_reject_duplicate_pairs,
            parse_constant=_reject_constant,
        )
    except JsonValidationError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise JsonValidationError("Payload is not valid UTF-8 JSON") from error
    if not isinstance(document, dict):
        raise JsonValidationError("JSON payload must be a top-level object")
    _validate_value(document)
    if expected_payload_type is not None:
        expected = (
            expected_payload_type.value
            if isinstance(expected_payload_type, PayloadType)
            else expected_payload_type
        )
        validate_envelope(document, expected)
    return document


def make_envelope(
    payload_type: PayloadType,
    *,
    producer: str,
    producer_version: str,
    data: Mapping[str, Any],
    created_at: str | None = None,
) -> dict[str, Any]:
    """Wrap payload data in the versioned SpeakUp JSON contract."""

    return {
        "schema_version": 1,
        "payload_type": payload_type.value,
        "producer": producer,
        "producer_version": producer_version,
        "created_at": created_at
        or datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
            "+00:00", "Z"
        ),
        "data": dict(data),
    }


def validate_envelope(document: Mapping[str, Any], expected_payload_type: str) -> None:
    """Validate required versioning fields without constraining payload data."""

    required = {
        "schema_version": int,
        "payload_type": str,
        "producer": str,
        "producer_version": str,
        "created_at": str,
        "data": dict,
    }
    for name, value_type in required.items():
        if not isinstance(document.get(name), value_type):
            raise JsonValidationError(f"JSON envelope field {name!r} is invalid")
    if document["schema_version"] != 1:
        raise JsonValidationError("Unsupported JSON envelope schema_version")
    if document["payload_type"] != expected_payload_type:
        raise JsonValidationError("JSON envelope payload_type does not match reference")
