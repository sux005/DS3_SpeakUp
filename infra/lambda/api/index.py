import json
import os
import re
import time
import uuid
import base64
import binascii

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Attr, Key


ddb = boto3.resource("dynamodb")
projects = ddb.Table(os.environ["PROJECTS_TABLE"])
recordings = ddb.Table(os.environ["RECORDINGS_TABLE"])
recording_hashes = ddb.Table(os.environ["RECORDING_HASHES_TABLE"])
s3 = boto3.client("s3", config=Config(signature_version="s3v4"))
sfn = boto3.client("stepfunctions")
bucket = os.environ["DATA_BUCKET"]
safe_id = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
content_types = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
}


def reply(code, body):
    return {
        "statusCode": code,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body, default=str),
    }


def identity(event):
    return (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
        .get("sub")
    )


def body_of(event):
    try:
        return json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return None


def valid(value):
    return isinstance(value, str) and safe_id.fullmatch(value) is not None


def sha256_hex(value):
    if not isinstance(value, str):
        return None
    try:
        digest = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        return None
    return digest.hex() if len(digest) == 32 and base64.b64encode(digest).decode() == value else None


def hash_key(user_id, project_id, checksum):
    return {"user_id": user_id, "project_hash": f"{project_id}#{sha256_hex(checksum)}"}


def existing_recording_for_hash(user_id, project_id, checksum):
    existing = recording_hashes.get_item(
        Key=hash_key(user_id, project_id, checksum), ConsistentRead=True
    ).get("Item")
    if not existing:
        return None
    recording_id = existing["recording_id"]
    previous = recordings.get_item(
        Key={"user_id": user_id, "recording_id": recording_id}, ConsistentRead=True
    ).get("Item")
    if not previous or previous["status"] == "FAILED":
        return None
    return reply(409, {"message": "Exact audio already submitted for this project", "duplicate_recording_id": recording_id})


def claim_recording_hash(item):
    checksum = item.get("source_sha256")
    if not checksum:
        return None  # Recordings created before checksum-backed uploads remain usable.
    key = hash_key(item["user_id"], item["project_id"], checksum)
    try:
        recording_hashes.put_item(
            Item={**key, "recording_id": item["recording_id"]},
            ConditionExpression="attribute_not_exists(project_hash)",
        )
        return None
    except recording_hashes.meta.client.exceptions.ConditionalCheckFailedException:
        existing = recording_hashes.get_item(Key=key, ConsistentRead=True)["Item"]
        previous_id = existing["recording_id"]
        if previous_id == item["recording_id"]:
            return None
        previous = recordings.get_item(
            Key={"user_id": item["user_id"], "recording_id": previous_id},
            ConsistentRead=True,
        ).get("Item")
        if previous and previous["status"] == "FAILED":
            try:
                recording_hashes.update_item(
                    Key=key,
                    UpdateExpression="SET recording_id=:new",
                    ConditionExpression=Attr("recording_id").eq(previous_id),
                    ExpressionAttributeValues={":new": item["recording_id"]},
                )
                return None
            except recording_hashes.meta.client.exceptions.ConditionalCheckFailedException:
                existing = recording_hashes.get_item(Key=key, ConsistentRead=True)["Item"]
                previous_id = existing["recording_id"]
        return reply(409, {"message": "Exact audio already submitted for this project", "duplicate_recording_id": previous_id})


def processing_reply(item):
    status = item["status"]
    return reply(
        202 if status not in {"COMPLETE", "FAILED"} else 200,
        {
            "recording_id": item["recording_id"],
            "status": status,
            "execution_arn": item["execution_arn"],
        },
    )


def start_claimed_execution(item):
    if item["status"] in {"COMPLETE", "FAILED"} or item.get(
        "execution_start_status"
    ) != "PENDING":
        return processing_reply(item)

    try:
        sfn.start_execution(
            stateMachineArn=os.environ["STATE_MACHINE_ARN"],
            name=item["execution_name"],
            input=json.dumps(
                {
                    "user_id": item["user_id"],
                    "recording_id": item["recording_id"],
                    "project_id": item["project_id"],
                    "audio_s3_key": item["audio_s3_key"],
                }
            ),
        )
    except sfn.exceptions.ExecutionAlreadyExists:
        # The same execution may have finished before a retry reached Step Functions.
        pass

    key = {"user_id": item["user_id"], "recording_id": item["recording_id"]}
    try:
        recordings.update_item(
            Key=key,
            UpdateExpression="SET execution_start_status=:started",
            ConditionExpression=Attr("execution_arn").eq(item["execution_arn"])
            & Attr("execution_start_status").eq("PENDING"),
            ExpressionAttributeValues={":started": "STARTED"},
        )
    except recordings.meta.client.exceptions.ConditionalCheckFailedException:
        # Another request already confirmed the same start.
        pass
    current = recordings.get_item(Key=key, ConsistentRead=True)["Item"]
    return processing_reply(current)


def handler(event, context):
    route = event.get("routeKey", "")
    if route == "GET /health":
        return reply(200, {"service": "speakup", "status": "ok"})

    user_id = identity(event)
    if not user_id:
        return reply(401, {"message": "Missing authenticated user"})

    body = body_of(event)
    if body is None:
        return reply(400, {"message": "Request body must be valid JSON"})
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    if route == "POST /projects":
        project_id = body.get("project_id") or str(uuid.uuid4())
        if not valid(project_id):
            return reply(400, {"message": "Invalid project_id"})
        item = {
            "user_id": user_id,
            "project_id": project_id,
            "project_title": str(body.get("project_title") or "Untitled project")[:200],
            "description": str(body.get("description") or "")[:2000],
            "created_at": now,
            "updated_at": now,
            "recording_count": 0,
        }
        projects.put_item(
            Item=item, ConditionExpression="attribute_not_exists(project_id)"
        )
        return reply(201, item)

    if route == "GET /projects":
        result = projects.query(KeyConditionExpression=Key("user_id").eq(user_id))
        return reply(200, {"items": result.get("Items", [])})

    if route == "POST /uploads":
        project_id = body.get("project_id")
        content_type = body.get("content_type")
        checksum = body.get("sha256")
        if not valid(project_id) or content_type not in content_types:
            return reply(
                400,
                {"message": "Valid project_id and WAV, MP3, or M4A content_type required"},
            )
        if sha256_hex(checksum) is None:
            return reply(400, {"message": "sha256 must be the Base64 SHA-256 of the audio file"})
        project = projects.get_item(
            Key={"user_id": user_id, "project_id": project_id}, ConsistentRead=True
        )
        if "Item" not in project:
            return reply(404, {"message": "Project not found"})
        duplicate = existing_recording_for_hash(user_id, project_id, checksum)
        if duplicate is not None:
            return duplicate
        recording_id = str(uuid.uuid4())
        key = (
            f"users/{user_id}/projects/{project_id}/recordings/{recording_id}/"
            f"original.{content_types[content_type]}"
        )
        item = {
            "user_id": user_id,
            "recording_id": recording_id,
            "project_id": project_id,
            "created_at": now,
            "updated_at": now,
            "status": "AWAITING_UPLOAD",
            "audio_s3_key": key,
            "content_type": content_type,
            "source_sha256": checksum,
        }
        recordings.put_item(
            Item=item, ConditionExpression="attribute_not_exists(recording_id)"
        )
        url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": bucket, "Key": key, "ContentType": content_type, "ChecksumSHA256": checksum},
            ExpiresIn=int(os.environ["URL_EXPIRY_SECONDS"]),
        )
        return reply(
            201,
            {
                "recording_id": recording_id,
                "object_key": key,
                "upload_url": url,
                "expires_in": int(os.environ["URL_EXPIRY_SECONDS"]),
                "upload_headers": {"Content-Type": content_type, "x-amz-checksum-sha256": checksum},
            },
        )

    recording_id = (event.get("pathParameters") or {}).get("recordingId")
    if not valid(recording_id):
        return reply(400, {"message": "Invalid recordingId"})
    found = recordings.get_item(
        Key={"user_id": user_id, "recording_id": recording_id}, ConsistentRead=True
    ).get("Item")
    if not found:
        return reply(404, {"message": "Recording not found"})

    if route == "GET /recordings/{recordingId}":
        return reply(200, found)

    if route == "POST /recordings/{recordingId}/process":
        if found["status"] != "AWAITING_UPLOAD":
            return start_claimed_execution(found)
        try:
            source = s3.head_object(
                Bucket=bucket, Key=found["audio_s3_key"],
                **({"ChecksumMode": "ENABLED"} if found.get("source_sha256") else {}),
            )
        except ClientError:
            return reply(409, {"message": "Upload is not complete"})
        if found.get("source_sha256"):
            if source.get("ChecksumSHA256") != found["source_sha256"]:
                return reply(409, {"message": "Uploaded audio SHA-256 does not match"})
            duplicate = claim_recording_hash(found)
            if duplicate is not None:
                return duplicate
        execution_name = recording_id
        state_machine_arn = os.environ["STATE_MACHINE_ARN"]
        execution_arn = state_machine_arn.replace(
            ":stateMachine:", ":execution:", 1
        ) + f":{execution_name}"
        try:
            recordings.update_item(
                Key={"user_id": user_id, "recording_id": recording_id},
                UpdateExpression=(
                    "SET #s=:processing, updated_at=:updated, execution_arn=:arn, "
                    "execution_name=:name, execution_start_status=:pending"
                ),
                ConditionExpression=Attr("status").eq("AWAITING_UPLOAD")
                & Attr("execution_arn").not_exists(),
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={
                    ":processing": "PROCESSING",
                    ":updated": now,
                    ":arn": execution_arn,
                    ":name": execution_name,
                    ":pending": "PENDING",
                },
            )
        except recordings.meta.client.exceptions.ConditionalCheckFailedException:
            current = recordings.get_item(
                Key={"user_id": user_id, "recording_id": recording_id},
                ConsistentRead=True,
            ).get("Item")
            if not current:
                return reply(404, {"message": "Recording not found"})
            if current["status"] == "AWAITING_UPLOAD":
                return reply(409, {"message": "Recording cannot be claimed"})
            return start_claimed_execution(current)
        return start_claimed_execution(
            {
                **found,
                "status": "PROCESSING",
                "execution_arn": execution_arn,
                "execution_name": execution_name,
                "execution_start_status": "PENDING",
            }
        )

    return reply(404, {"message": "Route not found"})
