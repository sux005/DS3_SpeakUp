"""Authenticated HTTP adapter for the internal SpeakUp payload API."""

from __future__ import annotations

from dataclasses import asdict
from decimal import Decimal
from functools import lru_cache
import hashlib
import json
import logging
import os
from typing import Any, Mapping
import uuid

import boto3
from boto3.dynamodb.conditions import Attr
from botocore.config import Config
from botocore.exceptions import ClientError

from src.aws_payload import PayloadType, Recording, RecordingStatus, SpeakUpPayloadStore
from src.aws_payload.checksum import sha256_base64_to_hex
from src.aws_payload.errors import (
    ActiveWorkflowLimitError,
    IdempotencyConflictError,
    OwnershipViolationError,
    PayloadAlreadyExistsError,
    PayloadIntegrityError,
    PayloadNotFoundError,
    PayloadValidationError,
    WriteConflictError,
)
from src.aws_payload.repositories import InvalidCursorError, InvalidTransitionError
from src.aws_payload.policy import ACTIVE_WORKFLOW_STATUSES


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
    digest = sha256_base64_to_hex(value)
    if digest is None:
        raise PayloadValidationError("sha256 must be the Base64 SHA-256 of the audio file")
    return digest


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


def reply(code: int, body: Any, *, headers: dict[str, str] | None = None) -> dict[str, Any]:
    """Build an API Gateway HTTP API JSON response."""

    def encode(value: Any) -> Any:
        if isinstance(value, Decimal):
            return int(value) if value == value.to_integral_value() else float(value)
        return str(value)

    return {
        "statusCode": code,
        "headers": {"content-type": "application/json", **(headers or {})},
        "body": json.dumps(body, default=encode, separators=(",", ":")),
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
    except (TypeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _integer(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        if value is None or value == "":
            result = default
        elif isinstance(value, bool) or not isinstance(value, (int, str)):
            raise ValueError("Expected an integer value")
        else:
            result = int(value)
    except (TypeError, ValueError) as error:
        raise PayloadValidationError("Expected an integer value") from error
    if not minimum <= result <= maximum:
        raise PayloadValidationError(
            f"Integer must be between {minimum} and {maximum}"
        )
    return result


def _recording_body(recording: Recording) -> dict[str, Any]:
    """Expose the stable client fields without storage or workflow internals."""

    body: dict[str, Any] = {
        "user_id": recording.user_id,
        "project_id": recording.project_id,
        "recording_id": recording.recording_id,
        "created_at": recording.created_at,
        "updated_at": recording.updated_at,
        "status": recording.status.value,
        "content_type": recording.content_type,
        "revision": recording.revision,
    }
    if recording.content_length is not None:
        body["content_length"] = recording.content_length
    if recording.summary_metrics:
        body["summary_metrics"] = dict(recording.summary_metrics)
    if recording.audio_prep_status:
        body["audio_prep_status"] = recording.audio_prep_status
    if recording.status is RecordingStatus.FAILED:
        body["failure_reason"] = "Processing failed"
    return body


def _artifact_body(
    store: SpeakUpPayloadStore,
    user_id: str,
    recording_id: str,
    artifact_type: str,
) -> dict[str, Any]:
    """Return only the client-facing data from an owner-checked S3 artifact."""

    payload_types = {
        "transcript": PayloadType.TRANSCRIPT,
        "analysis": PayloadType.SPEECH_ANALYSIS,
        "feedback": PayloadType.FEEDBACK,
    }
    payload_type = payload_types.get(artifact_type)
    if payload_type is None:
        raise PayloadValidationError(
            "artifactType must be transcript, analysis, or feedback"
        )
    document = store.get_json_artifact(user_id, recording_id, payload_type)
    data = document.get("data")
    if not isinstance(data, Mapping):
        raise PayloadIntegrityError("stored artifact data is invalid")

    if artifact_type == "transcript":
        text = data.get("text")
        items = data.get("items")
        if not isinstance(text, str) or not isinstance(items, list):
            raise PayloadIntegrityError("stored transcript is invalid")
        public_data: dict[str, Any] = {"text": text, "items": items}
    elif artifact_type == "analysis":
        metrics = data.get("metrics")
        if not isinstance(metrics, Mapping):
            raise PayloadIntegrityError("stored analysis is invalid")
        public_data = {"metrics": dict(metrics)}
    else:
        feedback = data.get("feedback")
        if not isinstance(feedback, str):
            raise PayloadIntegrityError("stored feedback is invalid")
        public_data = {"feedback": feedback}

    return {
        "recording_id": recording_id,
        "artifact_type": artifact_type,
        "data": public_data,
    }


def _processing_reply(recording: Recording) -> dict[str, Any]:
    return reply(
        200 if recording.status in {RecordingStatus.COMPLETE, RecordingStatus.FAILED} else 202,
        _recording_body(recording),
    )


def _workflow_limits(store: SpeakUpPayloadStore, user_id: str) -> dict[str, int]:
    """Return a stable quota response for the future frontend."""

    getter = getattr(store, "workflow_limits", None)
    if getter is None:
        limit = int(os.getenv("MAX_ACTIVE_WORKFLOWS", "3"))
        return {"active": 0, "limit": limit, "remaining": limit}
    return getter(user_id)


def _execution_name(recording: Recording) -> str:
    """Return a stable, owner-scoped Step Functions execution name."""

    # Step Functions names are globally unique per state machine for the
    # retention window. A digest keeps the name within AWS's 80-character
    # limit while preventing cross-owner/project recording ID collisions.
    scope = f"{recording.user_id}\x00{recording.project_id}\x00{recording.recording_id}"
    return "speakup-" + hashlib.sha256(scope.encode()).hexdigest()


def _execution_input(recording: Recording) -> str:
    return json.dumps(
        {
            "user_id": recording.user_id,
            "recording_id": recording.recording_id,
            "project_id": recording.project_id,
            "audio_s3_key": recording.original_s3_key,
        },
        sort_keys=True,
        separators=(",", ":"),
    )


def _start_claimed_execution(store: SpeakUpPayloadStore, recording: Recording) -> dict[str, Any]:
    if recording.status in {RecordingStatus.COMPLETE, RecordingStatus.FAILED} or recording.execution_start_status != "PENDING":
        return _processing_reply(recording)
    client = workflow_client()
    state_machine_arn = os.environ["STATE_MACHINE_ARN"]
    execution_name = _execution_name(recording)
    execution_input = _execution_input(recording)
    execution_arn = (
        state_machine_arn.replace(":stateMachine:", ":execution:", 1)
        + f":{execution_name}"
    )
    try:
        started = client.start_execution(
            stateMachineArn=state_machine_arn,
            name=execution_name,
            input=execution_input,
        )
        execution_arn = started.get("executionArn", execution_arn)
    except client.exceptions.ExecutionAlreadyExists:
        details = client.describe_execution(executionArn=execution_arn)
        if details.get("stateMachineArn") not in {None, state_machine_arn}:
            raise PayloadIntegrityError("existing workflow belongs to another state machine")
        try:
            existing_input = json.loads(details.get("input", "{}"))
        except (TypeError, json.JSONDecodeError) as error:
            raise PayloadIntegrityError("existing workflow input is invalid") from error
        if existing_input != json.loads(execution_input):
            raise PayloadIntegrityError("existing workflow input does not match recording")
        status = details.get("status")
        if status in {"FAILED", "TIMED_OUT", "ABORTED"}:
            try:
                failed = store.transition_recording(
                    recording.user_id, recording.recording_id,
                    RecordingStatus.FAILED,
                    expected_revision=recording.revision,
                    updates={"failure_reason": f"Workflow ended with {status}"},
                )
            except WriteConflictError:
                failed = store.get_recording(recording.user_id, recording.recording_id)
            return _processing_reply(failed)
        if status == "SUCCEEDED":
            current = store.get_recording(recording.user_id, recording.recording_id)
            if current.status is RecordingStatus.COMPLETE:
                return _processing_reply(current)
            raise PayloadIntegrityError("completed workflow has incomplete recording metadata")
        if status not in {"RUNNING", "PENDING"}:
            raise PayloadIntegrityError("existing workflow has unknown status")
    try:
        updated = store.recordings.patch(
            recording.user_id,
            recording.recording_id,
            expected_revision=recording.revision,
            updates={
                "execution_arn": execution_arn,
                "execution_start_status": "STARTED",
            },
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

    if route == "GET /account/limits":
        limits = _workflow_limits(store, user_id)
        return reply(
            200,
            {
                "active_workflows": int(limits["active"]),
                "max_active_workflows": int(limits["limit"]),
                "remaining_workflows": int(limits["remaining"]),
                "admission_enforced": bool(getattr(store.config, "enforce_workflow_admissions", False)),
                "max_audio_upload_bytes": int(store.config.max_audio_upload_bytes),
                "max_audio_duration_seconds": int(os.getenv("AUDIO_MAX_DURATION_SECONDS", "600")),
                "abandoned_retention_days": int(store.config.abandoned_retention_days),
                "deleted_recovery_days": int(store.config.recovery_days),
            },
        )

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
        request_id = str(
            event.get("requestContext", {}).get("requestId") or uuid.uuid4()
        )
        idempotency_key = str(body.get("idempotency_key") or request_id)
        if len(idempotency_key) > 36:
            raise PayloadValidationError("idempotency_key must contain at most 36 characters")
        reserved_id = str(uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"speakup:{user_id}:{project_id}:{idempotency_key}",
        ))
        requested_id = body.get("recording_id")
        if requested_id is not None and str(requested_id) != reserved_id:
            raise PayloadValidationError(
                "recording_id must match the deterministic idempotency reservation"
            )
        duplicate_id = duplicate_recording_id(store, user_id, project_id, checksum)
        if duplicate_id and duplicate_id != reserved_id:
            return reply(409, {"message": "Exact audio already submitted for this project", "duplicate_recording_id": duplicate_id})
        content_length = _integer(
            body.get("content_length"), 0, 1, store.config.max_audio_upload_bytes
        )
        recording, intent = store.reserve_upload(
            user_id,
            project_id,
            str(body.get("content_type") or ""),
            idempotency_key=idempotency_key,
            recording_id=reserved_id,
            source_sha256=checksum,
            content_length=content_length,
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
                "expected_content_length": intent.expected_content_length,
                "max_content_length": intent.max_content_length,
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
    if route == "GET /recordings/{recordingId}/artifacts/{artifactType}":
        return reply(
            200,
            _artifact_body(
                store,
                user_id,
                recording_id,
                str(path.get("artifactType") or ""),
            ),
        )
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
        execution_name = _execution_name(recording)
        execution_arn = state_machine_arn.replace(":stateMachine:", ":execution:", 1) + f":{execution_name}"
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
        if current.get("status") in ACTIVE_WORKFLOW_STATUSES:
            raise InvalidTransitionError(
                "processing recordings cannot be deleted until the workflow is terminal"
            )
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
    except ActiveWorkflowLimitError:
        return reply(
            429,
            {"code": "ACTIVE_WORKFLOW_LIMIT", "message": "active workflow limit reached", "retryable": True},
            headers={"retry-after": "60"},
        )
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
