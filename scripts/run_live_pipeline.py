"""Run one authenticated audio file through the deployed SpeakUp public pipeline.

The script creates a dedicated Cognito QA user, authenticates with SRP, uses
only public HTTP routes to upload and start processing, and observes Step
Functions read-only to produce a timestamped JSONL execution log.
"""

from __future__ import annotations

import argparse
import base64
from collections import defaultdict, deque
from datetime import datetime, timezone
import hashlib
import hmac
import json
from pathlib import Path
import secrets
import string
import sys
import time
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


N_HEX = (
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1"
    "29024E088A67CC74020BBEA63B139B22514A08798E3404DD"
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245"
    "E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED"
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D"
    "C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F"
    "83655D23DCA3AD961C62F356208552BB9ED529077096966D"
    "670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B"
    "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9"
    "DE2BCBF6955817183995497CEA956AE515D2261898FA0510"
    "15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64"
    "ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7"
    "ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6B"
    "F12FFA06D98A0864D87602733EC86A64521F2B18177B200C"
    "BBE117577A615D6C770988C0BAD946E208E24FA074E5AB31"
    "43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF"
)
N = int(N_HEX, 16)
G = 2
K = int(hashlib.sha256(bytes.fromhex("00" + N_HEX + "02")).hexdigest(), 16)
INFO_BITS = b"Caldera Derived Key"
TERMINAL_EXECUTION_STATUSES = {"SUCCEEDED", "FAILED", "TIMED_OUT", "ABORTED"}
_AUDIO_CONTENT_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
}


def _audio_content_type(path: Path) -> str:
    try:
        return _AUDIO_CONTENT_TYPES[path.suffix.lower()]
    except KeyError as error:
        supported = ", ".join(sorted(_AUDIO_CONTENT_TYPES))
        raise ValueError(f"unsupported audio extension; expected one of: {supported}") from error


def _pad_hex(value: int) -> str:
    result = format(value, "x")
    if len(result) % 2:
        result = "0" + result
    elif result[0] in "89abcdefABCDEF":
        result = "00" + result
    return result


def _hex_hash(value: str) -> str:
    return hashlib.sha256(bytes.fromhex(value)).hexdigest()


def _hkdf(ikm: bytes, salt: bytes) -> bytes:
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    return hmac.new(prk, INFO_BITS + b"\x01", hashlib.sha256).digest()[:16]


def _timestamp() -> str:
    now = datetime.now(timezone.utc)
    return f"{now:%a %b} {now.day} {now:%H:%M:%S UTC %Y}"


def authenticate_srp(client: Any, pool_id: str, client_id: str,
                     username: str, password: str) -> str:
    """Authenticate a public Cognito client without exposing the password."""

    small_a = int.from_bytes(secrets.token_bytes(128), "big") % N
    large_a = pow(G, small_a, N)
    initiated = client.initiate_auth(
        AuthFlow="USER_SRP_AUTH",
        ClientId=client_id,
        AuthParameters={"USERNAME": username, "SRP_A": format(large_a, "x")},
    )
    if initiated.get("ChallengeName") != "PASSWORD_VERIFIER":
        raise RuntimeError("Cognito did not return PASSWORD_VERIFIER")

    parameters = initiated["ChallengeParameters"]
    user_id = parameters["USER_ID_FOR_SRP"]
    large_b = int(parameters["SRP_B"], 16)
    salt = int(parameters["SALT"], 16)
    if large_b % N == 0:
        raise RuntimeError("Cognito returned an invalid SRP_B value")

    u_value = int(_hex_hash(_pad_hex(large_a) + _pad_hex(large_b)), 16)
    if u_value == 0:
        raise RuntimeError("Cognito returned an invalid SRP scrambling value")
    pool_name = pool_id.split("_", 1)[1]
    user_hash = hashlib.sha256(
        f"{pool_name}{user_id}:{password}".encode("utf-8")
    ).hexdigest()
    x_value = int(_hex_hash(_pad_hex(salt) + user_hash), 16)
    base = (large_b - K * pow(G, x_value, N)) % N
    shared_secret = pow(base, small_a + u_value * x_value, N)
    key = _hkdf(
        bytes.fromhex(_pad_hex(shared_secret)),
        bytes.fromhex(_pad_hex(u_value)),
    )
    secret_block = base64.b64decode(parameters["SECRET_BLOCK"])
    timestamp = _timestamp()
    message = pool_name.encode() + user_id.encode() + secret_block + timestamp.encode()
    signature = base64.b64encode(hmac.new(key, message, hashlib.sha256).digest()).decode()
    challenge_request = {
        "ClientId": client_id,
        "ChallengeName": "PASSWORD_VERIFIER",
        "ChallengeResponses": {
            "USERNAME": user_id,
            "PASSWORD_CLAIM_SECRET_BLOCK": parameters["SECRET_BLOCK"],
            "PASSWORD_CLAIM_SIGNATURE": signature,
            "TIMESTAMP": timestamp,
        },
    }
    if initiated.get("Session"):
        challenge_request["Session"] = initiated["Session"]
    completed = client.respond_to_auth_challenge(
        **challenge_request,
    )
    token = completed.get("AuthenticationResult", {}).get("IdToken")
    if not token:
        raise RuntimeError("Cognito authentication did not return an ID token")
    return token


def _jwt_claims(token: str) -> dict[str, Any]:
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


class RunLog:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.started = time.perf_counter()
        self._stream = path.open("w", encoding="utf-8")

    def close(self) -> None:
        self._stream.close()

    def emit(self, stage: str, status: str, **details: Any) -> None:
        elapsed = round(time.perf_counter() - self.started, 3)
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "elapsed_seconds": elapsed,
            "stage": stage,
            "status": status,
            **details,
        }
        self._stream.write(json.dumps(record, sort_keys=True) + "\n")
        self._stream.flush()
        suffix = " ".join(f"{key}={value}" for key, value in details.items())
        print(f"[{elapsed:8.3f}s] {stage}: {status}{(' ' + suffix) if suffix else ''}", flush=True)


def _http(method: str, url: str, *, token: str | None = None,
          payload: dict[str, Any] | None = None, body: bytes | None = None,
          headers: dict[str, str] | None = None) -> tuple[int, Any]:
    request_headers = dict(headers or {})
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    data = body
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    request = Request(url, data=data, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=120) as response:
            raw = response.read()
            content_type = response.headers.get("Content-Type", "")
            parsed = json.loads(raw) if raw and "json" in content_type else raw
            return response.status, parsed
    except HTTPError as error:
        raw = error.read()
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {}
        raise RuntimeError(f"{method} request failed with HTTP {error.code}: {parsed}") from error


def _api_json(method: str, base: str, path: str, *, token: str | None = None,
              payload: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
    status, response = _http(method, f"{base}{path}", token=token, payload=payload)
    if not isinstance(response, dict):
        raise RuntimeError(f"{method} {path} did not return JSON")
    return status, response


def _stack_outputs(client: Any, stack_name: str) -> dict[str, str]:
    stack = client.describe_stacks(StackName=stack_name)["Stacks"][0]
    if stack["StackStatus"] != "UPDATE_COMPLETE":
        raise RuntimeError(f"stack is not stable: {stack['StackStatus']}")
    return {item["OutputKey"]: item["OutputValue"] for item in stack["Outputs"]}


def _password() -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return "Qa9!" + "".join(secrets.choice(alphabet) for _ in range(24))


def _execution_arn(state_machine_arn: str, user_id: str,
                   project_id: str, recording_id: str) -> str:
    scope = f"{user_id}\x00{project_id}\x00{recording_id}"
    name = "speakup-" + hashlib.sha256(scope.encode()).hexdigest()
    return state_machine_arn.replace(":stateMachine:", ":execution:", 1) + f":{name}"


def _new_history(client: Any, execution_arn: str, after_id: int) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    paginator = client.get_paginator("get_execution_history")
    for page in paginator.paginate(
        executionArn=execution_arn,
        reverseOrder=False,
        PaginationConfig={"PageSize": 1000},
    ):
        events.extend(event for event in page.get("events", []) if event["id"] > after_id)
    return events


def run(args: argparse.Namespace) -> Path:
    audio_path = args.audio.resolve()
    content_type = _audio_content_type(audio_path)
    audio = audio_path.read_bytes()
    if not audio:
        raise RuntimeError("the input must be a non-empty audio file")
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    log_path = args.log or Path("results/live-e2e") / f"pipeline-{run_id}.jsonl"
    log = RunLog(log_path.resolve())

    config = Config(
        retries={"total_max_attempts": 4, "mode": "adaptive"},
        connect_timeout=10,
        read_timeout=30,
    )
    profile_name = None if args.profile == "environment" else args.profile
    session = boto3.Session(profile_name=profile_name, region_name=args.region)
    cloudformation = session.client("cloudformation", config=config)
    cognito = session.client("cognito-idp", config=config)
    stepfunctions = session.client("stepfunctions", config=config)

    try:
        outputs = _stack_outputs(cloudformation, args.stack_name)
        api = outputs["ApiEndpoint"].rstrip("/")
        pool_id = outputs["UserPoolId"]
        client_id = outputs["UserPoolClientId"]
        state_machine_arn = outputs["ProcessingStateMachineArn"]
        log.emit("stack", "SUCCESS", stack=args.stack_name)

        _, health = _api_json("GET", api, "/health")
        if health.get("status") != "ok":
            raise RuntimeError("health endpoint did not report ok")
        log.emit("api_health", "SUCCESS")

        username = f"speakup-e2e-{run_id.lower()}@example.com"
        password = _password()
        cognito.admin_create_user(
            UserPoolId=pool_id,
            Username=username,
            MessageAction="SUPPRESS",
            UserAttributes=[
                {"Name": "email", "Value": username},
                {"Name": "email_verified", "Value": "true"},
            ],
        )
        cognito.admin_set_user_password(
            UserPoolId=pool_id,
            Username=username,
            Password=password,
            Permanent=True,
        )
        log.emit("cognito_user", "SUCCESS", username=username)
        token = authenticate_srp(cognito, pool_id, client_id, username, password)
        claims = _jwt_claims(token)
        user_id = claims["sub"]
        log.emit("cognito_auth", "SUCCESS")

        _, project = _api_json(
            "POST", api, "/projects", token=token,
            payload={"project_title": f"Live pipeline QA {run_id}"},
        )
        project_id = project["project_id"]
        log.emit("create_project", "SUCCESS", project_id=project_id)

        digest = hashlib.sha256(audio).digest()
        _, reservation = _api_json(
            "POST", api, "/uploads", token=token,
            payload={
                "project_id": project_id,
                "content_type": content_type,
                "sha256": base64.b64encode(digest).decode("ascii"),
                "content_length": len(audio),
                "idempotency_key": str(uuid.uuid4()),
            },
        )
        recording_id = reservation["recording_id"]
        log.emit(
            "reserve_upload", "SUCCESS",
            recording_id=recording_id, bytes=len(audio),
        )

        upload_started = time.perf_counter()
        upload_status, _ = _http(
            "PUT", reservation["upload_url"], body=audio,
            headers=reservation["required_headers"],
        )
        log.emit(
            "upload_audio", "SUCCESS",
            http_status=upload_status,
            content_type=content_type,
            duration_seconds=round(time.perf_counter() - upload_started, 3),
        )
        process_started = time.perf_counter()
        log.emit(
            "automatic_upload_trigger", "WAITING",
            message="No confirm-upload or process request was sent",
        )
        execution_arn = _execution_arn(
            state_machine_arn, user_id, project_id, recording_id
        )

        deadline = time.monotonic() + args.timeout_minutes * 60
        last_event_id = 0
        last_recording_status: str | None = None
        execution_status: str | None = None
        state_starts: dict[str, deque[datetime]] = defaultdict(deque)
        state_durations: dict[str, list[float]] = defaultdict(list)
        recording: dict[str, Any] = {}
        while time.monotonic() < deadline:
            try:
                execution = stepfunctions.describe_execution(executionArn=execution_arn)
                execution_status = execution["status"]
                for event in _new_history(stepfunctions, execution_arn, last_event_id):
                    last_event_id = max(last_event_id, event["id"])
                    event_type = event["type"]
                    if event_type.endswith("StateEntered"):
                        details = event.get("stateEnteredEventDetails", {})
                        name = details.get("name", event_type)
                        state_starts[name].append(event["timestamp"])
                        log.emit(
                            f"workflow.{name}", "ENTERED",
                            event_id=event["id"], state_type=event_type,
                        )
                    elif event_type.endswith("StateExited"):
                        details = event.get("stateExitedEventDetails", {})
                        name = details.get("name", event_type)
                        duration = None
                        if state_starts[name]:
                            duration = round(
                                (event["timestamp"] - state_starts[name].popleft()).total_seconds(),
                                3,
                            )
                            state_durations[name].append(duration)
                        log.emit(
                            f"workflow.{name}", "EXITED",
                            event_id=event["id"], duration_seconds=duration,
                        )
                    elif event_type in {
                        "ExecutionSucceeded", "ExecutionFailed",
                        "ExecutionTimedOut", "ExecutionAborted",
                    }:
                        log.emit("workflow.execution", event_type)
            except stepfunctions.exceptions.ExecutionDoesNotExist:
                execution_status = None

            _, recording = _api_json(
                "GET", api, f"/recordings/{recording_id}", token=token
            )
            status = str(recording.get("status"))
            if status != last_recording_status:
                log.emit("recording_status", status)
                last_recording_status = status
            if execution_status in TERMINAL_EXECUTION_STATUSES and status in {"COMPLETE", "FAILED"}:
                break
            time.sleep(args.poll_seconds)
        else:
            raise RuntimeError("pipeline did not finish before the configured timeout")

        if execution_status != "SUCCEEDED" or recording.get("status") != "COMPLETE":
            raise RuntimeError(
                f"pipeline failed: execution={execution_status}, recording={recording.get('status')}"
            )
        log.emit(
            "pipeline", "SUCCESS",
            duration_seconds=round(time.perf_counter() - process_started, 3),
        )

        artifact_summaries: dict[str, Any] = {}
        artifact_types = ["transcript", "analysis"]
        if recording.get("feedback_s3_key"):
            artifact_types.append("feedback")
        else:
            log.emit(
                "artifact.feedback",
                "SKIPPED",
                reason="Bedrock feedback is disabled for this deployment",
            )
        for artifact_type in artifact_types:
            _, artifact = _api_json(
                "GET", api,
                f"/recordings/{recording_id}/artifacts/{artifact_type}",
                token=token,
            )
            data = artifact["data"]
            if artifact_type == "transcript":
                summary = {
                    "items": len(data.get("items", [])),
                    "text_characters": len(data.get("text", "")),
                }
            elif artifact_type == "analysis":
                metrics = data.get("metrics", {})
                summary = {
                    "word_count": metrics.get("word_count"),
                    "words_per_minute": metrics.get("words_per_minute"),
                    "filler_count": metrics.get("filler_count"),
                    "filler_occurrences": len(metrics.get("filler_occurrences", [])),
                    "pause_occurrences": len(metrics.get("pauses", [])),
                    "rubric_status": metrics.get("rubric_status"),
                }
            else:
                summary = {"feedback_characters": len(data.get("feedback", ""))}
            artifact_summaries[artifact_type] = summary
            log.emit(f"artifact.{artifact_type}", "SUCCESS", **summary)

        _, download = _api_json(
            "GET", api, f"/recordings/{recording_id}/download", token=token
        )
        _, downloaded = _http("GET", download["download_url"])
        if not isinstance(downloaded, bytes) or hashlib.sha256(downloaded).digest() != digest:
            raise RuntimeError("downloaded original audio checksum did not match")
        log.emit("original_download", "SUCCESS", sha256_verified=True)
        log.emit(
            "run", "SUCCESS",
            username=username,
            project_id=project_id,
            recording_id=recording_id,
            execution_status=execution_status,
            state_durations={
                name: {
                    "count": len(values),
                    "total_seconds": round(sum(values), 3),
                    "max_seconds": round(max(values), 3),
                }
                for name, values in state_durations.items()
            },
            artifacts=artifact_summaries,
        )
        return log.path
    except Exception as error:
        log.emit("run", "FAILED", error_type=type(error).__name__, error=str(error)[:1000])
        raise
    finally:
        log.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    parser.add_argument(
        "--profile",
        default="speakup-dev",
        help="AWS profile name, or 'environment' for process-scoped credentials",
    )
    parser.add_argument("--region", default="us-east-2")
    parser.add_argument("--stack-name", default="speakup-dev")
    parser.add_argument("--timeout-minutes", type=int, default=30)
    parser.add_argument("--poll-seconds", type=int, default=5)
    parser.add_argument("--log", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        log_path = run(args)
        print(f"Detailed log: {log_path}")
        return 0
    except (ClientError, RuntimeError, OSError, ValueError) as error:
        print(f"Pipeline run failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
