import json
import os
import re
import time
import uuid

import boto3
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Key


ddb = boto3.resource("dynamodb")
projects = ddb.Table(os.environ["PROJECTS_TABLE"])
recordings = ddb.Table(os.environ["RECORDINGS_TABLE"])
s3 = boto3.client("s3")
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
        if not valid(project_id) or content_type not in content_types:
            return reply(
                400,
                {"message": "Valid project_id and WAV, MP3, or M4A content_type required"},
            )
        project = projects.get_item(
            Key={"user_id": user_id, "project_id": project_id}, ConsistentRead=True
        )
        if "Item" not in project:
            return reply(404, {"message": "Project not found"})
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
        }
        recordings.put_item(
            Item=item, ConditionExpression="attribute_not_exists(recording_id)"
        )
        url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=int(os.environ["URL_EXPIRY_SECONDS"]),
        )
        return reply(
            201,
            {
                "recording_id": recording_id,
                "object_key": key,
                "upload_url": url,
                "expires_in": int(os.environ["URL_EXPIRY_SECONDS"]),
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
        try:
            s3.head_object(Bucket=bucket, Key=found["audio_s3_key"])
        except ClientError:
            return reply(409, {"message": "Upload is not complete"})
        execution = sfn.start_execution(
            stateMachineArn=os.environ["STATE_MACHINE_ARN"],
            name=f"{recording_id}-{uuid.uuid4().hex[:10]}",
            input=json.dumps(
                {
                    "user_id": user_id,
                    "recording_id": recording_id,
                    "project_id": found["project_id"],
                    "audio_s3_key": found["audio_s3_key"],
                }
            ),
        )
        recordings.update_item(
            Key={"user_id": user_id, "recording_id": recording_id},
            UpdateExpression="SET #s=:s, updated_at=:u, execution_arn=:e",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":s": "PROCESSING",
                ":u": now,
                ":e": execution["executionArn"],
            },
        )
        return reply(
            202,
            {
                "recording_id": recording_id,
                "status": "PROCESSING",
                "execution_arn": execution["executionArn"],
            },
        )

    return reply(404, {"message": "Route not found"})
