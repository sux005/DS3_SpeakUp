"""Authenticated HTTP adapter for the internal SpeakUp payload API."""

from __future__ import annotations

from dataclasses import asdict
from functools import lru_cache
import base64
import binascii
import json
import logging
import os
from typing import Any
import uuid

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.config import Config
from botocore.exceptions import ClientError

from src.aws_payload import Recording, RecordingStatus, SpeakUpPayloadStore
from src.aws_payload.errors import (
    IdempotencyConflictError,
    OwnershipViolationError,
    PayloadAlreadyExistsError,
    PayloadIntegrityError,
    PayloadNotFoundError,
    PayloadValidationError,
    WriteConflictError,
)
from src.aws_payload.repositories import InvalidCursorError, InvalidTransitionError


LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)


@lru_cache(maxsize=1)
def payloads() -> SpeakUpPayloadStore:
    """Reuse the service and its clients across warm invocations."""

    return SpeakUpPayloadStore.from_environment()


@lru_cache(maxsize=1)
def workflow_client() -> Any:
    """Return a bounded-retry Step Functions client."""

    return boto3.client(
        "stepfunctions",
        config=Config(
            retries={"total_max_attempts": 3, "mode": "adaptive"},
            connect_timeout=5,
            read_timeout=15,
            user_agent_appid="speakup-api/1.0",
        ),
    )


@lru_cache(maxsize=1)
def recording_hashes() -> Any:
    return boto3.resource("dynamodb").Table(os.environ["RECORDING_HASHES_TABLE"])


def checksum_hex(value: Any) -> str:
    if not isinstance(value, str):
        raise PayloadValidationError("sha256 must be the Base64 SHA-256 of the audio file")
    try:
        digest = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as error:
        raise PayloadValidationError("sha256 must be the Base64 SHA-256 of the audio file") from error
    if len(digest) != 32 or base64.b64encode(digest).decode("ascii") != value:
        raise PayloadValidationError("sha256 must be the Base64 SHA-256 of the audio file")
    return digest.hex()


def hash_key(user_id: str, project_id: str, checksum: str) -> dict[str, str]:
    return {"user_id": user_id, "project_hash": f"{project_id}#{checksum_hex(checksum)}"}


def duplicate_recording_id(store: SpeakUpPayloadStore, user_id: str, project_id: str, checksum: str) -> str | None:
    existing = recording_hashes().get_item(
        Key=hash_key(user_id, project_id, checksum), ConsistentRead=True
    ).get("Item")
    if not existing:
        return None
    recording_id = str(existing["recording_id"])
    try:
        prior = store.recordings.get(user_id, recording_id, include_deleted=True)
    except PayloadNotFoundError:
        return None
    if prior["status"] in {"FAILED", "DELETED", "PURGE_PENDING"}:
        return None
    return recording_id


def claim_recording_hash(store: SpeakUpPayloadStore, recording: Recording) -> str | None:
    checksum = recording.source_sha256
    if not checksum:
        return None  # Legacy reservations have no browser-verified checksum.
    key = hash_key(recording.user_id, recording.project_id, checksum)
    table = recording_hashes()
    try:
        table.put_item(
            Item={**key, "recording_id": recording.recording_id},
            ConditionExpression="attribute_not_exists(project_hash)",
        )
        return None
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        existing = table.get_item(Key=key, ConsistentRead=True)["Item"]
        prior_id = str(existing["recording_id"])
        if prior_id == recording.recording_id:
            return None
        try:
            prior = store.recordings.get(recording.user_id, prior_id, include_deleted=True)
        except PayloadNotFoundError:
            prior = None
        if prior is None or prior["status"] in {"FAILED", "DELETED", "PURGE_PENDING"}:
            try:
                table.update_item(
                    Key=key,
                    UpdateExpression="SET recording_id=:new",
                    ConditionExpression=Attr("recording_id").eq(prior_id),
                    ExpressionAttributeValues={":new": recording.recording_id},
                )
                return None
            except table.meta.client.exceptions.ConditionalCheckFailedException:
                return str(table.get_item(Key=key, ConsistentRead=True)["Item"]["recording_id"])
        return prior_id


def reply(code: int, body: Any) -> dict[str, Any]:
    """Build an API Gateway HTTP API JSON response."""

    return {
        "statusCode": code,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body, default=str, separators=(",", ":")),
    }


def identity(event: dict[str, Any]) -> str | None:
    """Return the Cognito subject claim used as the immutable owner ID."""

    return (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
        .get("sub")
    )


def body_of(event: dict[str, Any]) -> dict[str, Any] | None:
    """Decode a JSON object request body without accepting arrays or scalars."""

    try:
        value = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _integer(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        result = default if value in {None, ""} else int(value)
    except (TypeError, ValueError) as error:
        raise PayloadValidationError("Expected an integer value") from error
    if not minimum <= result <= maximum:
        raise PayloadValidationError(
            f"Integer must be between {minimum} and {maximum}"
        )
    return result


def _recording_body(recording: Recording) -> dict[str, Any]:
    return recording.as_item()


def _processing_reply(recording: Recording) -> dict[str, Any]:
    return reply(
        200 if recording.status in {RecordingStatus.COMPLETE, RecordingStatus.FAILED} else 202,
        _recording_body(recording),
    )


def _start_claimed_execution(store: SpeakUpPayloadStore, recording: Recording) -> dict[str, Any]:
    if recording.status in {RecordingStatus.COMPLETE, RecordingStatus.FAILED} or recording.execution_start_status != "PENDING":
        return _processing_reply(recording)
    client = workflow_client()
    try:
        client.start_execution(
            stateMachineArn=os.environ["STATE_MACHINE_ARN"],
            name=recording.recording_id,
            input=json.dumps(
                {
                    "user_id": recording.user_id,
                    "recording_id": recording.recording_id,
                    "project_id": recording.project_id,
                    "audio_s3_key": recording.original_s3_key,
                },
                separators=(",", ":"),
            ),
        )
    except client.exceptions.ExecutionAlreadyExists:
        pass
    try:
        updated = store.recordings.patch(
            recording.user_id,
            recording.recording_id,
            expected_revision=recording.revision,
            updates={"execution_start_status": "STARTED"},
        )
        return _processing_reply(Recording.from_item(updated))
    except WriteConflictError:
        return _processing_reply(store.get_recording(recording.user_id, recording.recording_id))


def _dispatch(event: dict[str, Any]) -> dict[str, Any]:
    route = event.get("routeKey", "")
    if route == "GET /health":
        return reply(200, {"service": "speakup", "status": "ok"})
    user_id = identity(event)
    if not user_id:
        return reply(401, {"message": "Missing authenticated user"})
    body = body_of(event)
    if body is None:
        raise PayloadValidationError("Request body must be a JSON object")
    store = payloads()

    if route == "POST /projects":
        project = store.create_project(
            user_id,
            project_id=body.get("project_id"),
            project_title=str(body.get("project_title") or "Untitled project"),
            description=str(body.get("description") or ""),
        )
        return reply(201, asdict(project))
    if route == "GET /projects":
        query = event.get("queryStringParameters") or {}
        page = store.list_projects(
            user_id,
            limit=_integer(query.get("limit"), 50, 1, 100),
            cursor=query.get("cursor"),
        )
        return reply(
            200,
            {
                "items": [asdict(project) for project in page.items],
                "next_cursor": page.next_cursor,
            },
        )
    if route == "POST /uploads":
        project_id = str(body.get("project_id") or "")
        checksum = body.get("sha256")
        checksum_hex(checksum)
        store.get_project(user_id, project_id)
        duplicate_id = duplicate_recording_id(store, user_id, project_id, checksum)
        if duplicate_id:
            return reply(409, {"message": "Exact audio already submitted for this project", "duplicate_recording_id": duplicate_id})
        request_id = str(
            event.get("requestContext", {}).get("requestId") or uuid.uuid4()
        )
        recording, intent = store.reserve_upload(
            user_id,
            project_id,
            str(body.get("content_type") or ""),
            idempotency_key=str(body.get("idempotency_key") or request_id)[:36],
            recording_id=body.get("recording_id"),
            source_sha256=checksum,
        )
        return reply(
            201,
            {
                "recording": _recording_body(recording),
                "recording_id": recording.recording_id,
                "object_key": intent.key,
                "upload_url": intent.upload_url,
                "expires_at": intent.expires_at,
                "required_headers": dict(intent.required_headers),
            },
        )

    path = event.get("pathParameters") or {}
    if route == "GET /projects/{projectId}/recordings":
        query = event.get("queryStringParameters") or {}
        page = store.list_recordings(
            user_id,
            str(path.get("projectId") or ""),
            limit=_integer(query.get("limit"), 50, 1, 100),
            cursor=query.get("cursor"),
        )
        return reply(
            200,
            {
                "items": [_recording_body(item) for item in page.items],
                "next_cursor": page.next_cursor,
            },
        )

    recording_id = str(path.get("recordingId") or "")
    if route == "GET /recordings/{recordingId}":
        return reply(200, _recording_body(store.get_recording(user_id, recording_id)))
    if route == "POST /recordings/{recordingId}/confirm-upload":
        return reply(200, _recording_body(store.confirm_upload(user_id, recording_id)))
    if route == "GET /recordings/{recordingId}/download":
        return reply(
            200,
            {
                "recording_id": recording_id,
                "download_url": store.create_original_download_url(
                    user_id, recording_id
                ),
                "expires_in": store.config.upload_url_ttl_seconds,
            },
        )
    if route == "POST /recordings/{recordingId}/process":
        recording = store.get_recording(user_id, recording_id)
        if recording.status in {RecordingStatus.COMPLETE, RecordingStatus.FAILED}:
            return _processing_reply(recording)
        if recording.status in {RecordingStatus.PROCESSING, RecordingStatus.TRANSCRIBING, RecordingStatus.ANALYZED}:
            return _start_claimed_execution(store, recording)
        if recording.status is RecordingStatus.AWAITING_UPLOAD:
            recording = store.confirm_upload(user_id, recording_id)
        duplicate_id = claim_recording_hash(store, recording)
        if duplicate_id:
            return reply(409, {"message": "Exact audio already submitted for this project", "duplicate_recording_id": duplicate_id})
        state_machine_arn = os.environ["STATE_MACHINE_ARN"]
        execution_arn = state_machine_arn.replace(":stateMachine:", ":execution:", 1) + f":{recording_id}"
        try:
            processing = store.transition_recording(
                user_id,
                recording_id,
                RecordingStatus.PROCESSING,
                expected_revision=recording.revision,
                updates={"execution_arn": execution_arn, "execution_start_status": "PENDING"},
            )
        except (WriteConflictError, InvalidTransitionError):
            return _start_claimed_execution(store, store.get_recording(user_id, recording_id))
        return _start_claimed_execution(store, processing)

    current = store.recordings.get(user_id, recording_id, include_deleted=True)
    expected_revision = _integer(
        body.get("expected_revision"),
        int(current.get("revision", 0)),
        0,
        2_147_483_647,
    )
    if route == "DELETE /recordings/{recordingId}":
        result = store.soft_delete(
            user_id, recording_id, expected_revision=expected_revision
        )
        return reply(200, _recording_body(result))
    if route == "POST /recordings/{recordingId}/restore":
        result = store.recover(
            user_id, recording_id, expected_revision=expected_revision
        )
        return reply(200, _recording_body(result))
    if route == "DELETE /recordings/{recordingId}/permanent":
        count = store.permanently_delete(
            user_id,
            recording_id,
            expected_revision=expected_revision,
            confirmation=str(body.get("confirmation") or ""),
            purge_token=str(
                event.get("requestContext", {}).get("requestId") or uuid.uuid4()
            )[:36],
        )
        return reply(200, {"recording_id": recording_id, "deleted_versions": count})
    return reply(404, {"message": "Route not found"})


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Map domain failures to stable HTTP responses without leaking AWS details."""

    del context
    try:
        return _dispatch(event)
    except (PayloadNotFoundError, OwnershipViolationError):
        return reply(404, {"message": "Resource not found"})
    except (
        PayloadAlreadyExistsError,
        IdempotencyConflictError,
        WriteConflictError,
        InvalidTransitionError,
        PayloadIntegrityError,
    ) as error:
        return reply(409, {"message": str(error)})
    except (PayloadValidationError, InvalidCursorError, ValueError) as error:
        return reply(400, {"message": str(error)})
    except ClientError as error:
        LOGGER.exception(
            "AWS backend request failed",
            extra={
                "aws_error_code": error.response.get("Error", {}).get("Code"),
                "aws_request_id": error.response.get("ResponseMetadata", {}).get(
                    "RequestId"
                ),
            },
        )
        return reply(503, {"message": "Backend temporarily unavailable"})
