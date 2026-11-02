"""Opt-in development smoke test for the deployed backend workflow.

Set SPEAKUP_LIVE_E2E=1, SPEAKUP_E2E_API_URL, SPEAKUP_E2E_JWT, and
SPEAKUP_E2E_WAV_PATH to run. The WAV must contain non-private spoken English.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import uuid
import wave

import pytest


WORKFLOW_REQUIRED_ENV = (
    "SPEAKUP_E2E_API_URL",
    "SPEAKUP_E2E_JWT",
    "SPEAKUP_E2E_WAV_PATH",
)
def _synthetic_wav() -> bytes:
    """Return a small non-private PCM fixture for deployed storage checks."""

    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16_000)
        audio.writeframes(b"\0\0" * 1600)
    return output.getvalue()


def _request_status(method: str, url: str, *, token: str | None = None,
                    body: bytes | None = None, headers: dict[str, str] | None = None) -> tuple[int, dict]:
    request_headers = dict(headers or {})
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    if body is not None and method != "PUT":
        request_headers["Content-Type"] = "application/json"
    request = Request(url, data=body, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else {}
    except HTTPError as error:
        raw = error.read()
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {}
        return error.code, payload


def _request(method: str, url: str, *, token: str | None = None,
             body: bytes | None = None, headers: dict[str, str] | None = None) -> dict:
    status, payload = _request_status(method, url, token=token, body=body, headers=headers)
    if status >= 400:
        raise AssertionError(f"{method} request failed with HTTP {status}")
    return payload


@pytest.mark.skipif(
    os.environ.get("SPEAKUP_LIVE_API") != "1"
    or any(not os.environ.get(name) for name in ("SPEAKUP_E2E_API_URL", "SPEAKUP_E2E_JWT")),
    reason="live API checkpoints require explicit opt-in, endpoint, and JWT",
)
def test_deployed_api_checkpoints():
    """Check auth, project shape, reservation, S3 bytes, and owner-scoped reads."""

    base = os.environ["SPEAKUP_E2E_API_URL"].rstrip("/")
    token = os.environ["SPEAKUP_E2E_JWT"]
    assert _request("GET", f"{base}/health")["status"] == "ok"
    assert _request_status("GET", f"{base}/projects")[0] in {401, 403}

    project = _request("POST", f"{base}/projects", token=token, body=json.dumps({
        "project_title": f"API QA {uuid.uuid4().hex[:8]}"
    }).encode())
    project_id = project["project_id"]
    assert "recording_count" not in project and "recording_ids" not in project
    cursor = None
    for _ in range(100):
        query = urlencode({"limit": 100, **({"cursor": cursor} if cursor else {})})
        projects = _request("GET", f"{base}/projects?{query}", token=token)
        if any(item["project_id"] == project_id for item in projects["items"]):
            break
        cursor = projects.get("next_cursor")
        if not cursor:
            pytest.fail("new project was not returned by owner-scoped listing")
    else:
        pytest.fail("project listing exceeded the checkpoint page limit")

    audio = _synthetic_wav()
    checksum = base64.b64encode(hashlib.sha256(audio).digest()).decode("ascii")
    reservation = {
        "project_id": project_id, "content_type": "audio/wav",
        "sha256": checksum, "idempotency_key": str(uuid.uuid4()),
    }
    assert _request_status("POST", f"{base}/uploads", token=token,
                           body=json.dumps(reservation).encode())[0] == 400
    reservation["content_length"] = len(audio)
    reserved = _request("POST", f"{base}/uploads", token=token,
                        body=json.dumps(reservation).encode())
    repeated = _request("POST", f"{base}/uploads", token=token,
                        body=json.dumps(reservation).encode())
    assert repeated["recording_id"] == reserved["recording_id"]
    assert reserved["expected_content_length"] == len(audio)
    assert "Content-Length" not in reserved["required_headers"]

    recording_id = reserved["recording_id"]
    _request("PUT", reserved["upload_url"], body=audio,
             headers=reserved["required_headers"])
    confirmed = _request("POST", f"{base}/recordings/{recording_id}/confirm-upload",
                         token=token, body=b"{}")
    assert confirmed["status"] == "UPLOADED"
    assert confirmed["content_length"] == len(audio)
    assert _request("GET", f"{base}/recordings/{recording_id}", token=token)["project_id"] == project_id

    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        listed = _request("GET", f"{base}/projects/{project_id}/recordings", token=token)
        if any(item["recording_id"] == recording_id for item in listed["items"]):
            break
        time.sleep(2)
    else:
        pytest.fail("uploaded recording did not appear in its project listing")

    download = _request("GET", f"{base}/recordings/{recording_id}/download", token=token)
    with urlopen(download["download_url"], timeout=30) as response:
        assert hashlib.sha256(response.read()).digest() == hashlib.sha256(audio).digest()


@pytest.mark.skipif(
    os.environ.get("SPEAKUP_LIVE_E2E") != "1"
    or any(not os.environ.get(name) for name in WORKFLOW_REQUIRED_ENV),
    reason="live backend E2E requires explicit opt-in, API JWT, and speech WAV",
)
def test_deployed_upload_to_feedback_and_original_download():
    """Exercise reservation, signed PUT, confirmation, processing, and retrieval."""

    base = os.environ["SPEAKUP_E2E_API_URL"].rstrip("/")
    token = os.environ["SPEAKUP_E2E_JWT"]
    source = Path(os.environ["SPEAKUP_E2E_WAV_PATH"])
    audio = source.read_bytes()
    assert source.suffix.lower() == ".wav"
    assert 0 < len(audio) <= 100 * 1024 * 1024
    digest = hashlib.sha256(audio).digest()
    checksum = base64.b64encode(digest).decode("ascii")
    project = _request("POST", f"{base}/projects", token=token,
                       body=json.dumps({"project_title": f"QA {uuid.uuid4().hex[:8]}"}).encode())
    project_id = project["project_id"]
    reserved = _request("POST", f"{base}/uploads", token=token,
                        body=json.dumps({
                            "project_id": project_id,
                            "content_type": "audio/wav",
                            "sha256": checksum,
                            "content_length": len(audio),
                            "idempotency_key": str(uuid.uuid4()),
                        }).encode())
    recording_id = reserved["recording_id"]
    _request("PUT", reserved["upload_url"], body=audio,
             headers=reserved["required_headers"])
    confirmed = _request("POST", f"{base}/recordings/{recording_id}/confirm-upload",
                         token=token, body=b"{}")
    assert confirmed["status"] == "UPLOADED"
    _request("POST", f"{base}/recordings/{recording_id}/process", token=token,
             body=b"{}")

    deadline = time.monotonic() + 30 * 60
    while time.monotonic() < deadline:
        recording = _request("GET", f"{base}/recordings/{recording_id}", token=token)
        if recording["status"] in {"COMPLETE", "FAILED"}:
            break
        time.sleep(10)
    else:
        pytest.fail("recording did not reach a terminal status within 30 minutes")

    assert recording["status"] == "COMPLETE", f"workflow ended in {recording['status']}"
    assert recording["summary_metrics"]["word_count"] > 0
    assert "payload_refs" not in recording
    assert "execution_arn" not in recording
    download = _request("GET", f"{base}/recordings/{recording_id}/download", token=token)
    with urlopen(download["download_url"], timeout=30) as response:
        assert hashlib.sha256(response.read()).digest() == digest
