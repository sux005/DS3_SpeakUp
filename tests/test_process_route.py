"""Behavior tests for the merged payload API's process route."""

from __future__ import annotations

import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import threading
import types
from unittest.mock import patch

import pytest

from src.aws_payload.errors import WriteConflictError
from src.aws_payload.models import Project, Recording, RecordingStatus


class ExecutionAlreadyExists(Exception):
    pass


class StepFunctions:
    def __init__(self):
        self.exceptions = types.SimpleNamespace(ExecutionAlreadyExists=ExecutionAlreadyExists)
        self.calls, self.executions = [], set()
        self.fail_once = self.ack_lost_once = False
        self.lock = threading.Lock()

    def start_execution(self, **kwargs):
        with self.lock:
            self.calls.append(kwargs)
            key = (kwargs["name"], kwargs["input"])
            if self.fail_once:
                self.fail_once = False
                raise RuntimeError("temporary start failure")
            if key in self.executions:
                raise ExecutionAlreadyExists()
            self.executions.add(key)
            if self.ack_lost_once:
                self.ack_lost_once = False
                raise RuntimeError("response lost after start")
            return {"executionArn": f"arn:execution:{kwargs['name']}"}


class HashTable:
    def __init__(self):
        self.items, self.lock = {}, threading.Lock()
        self.meta = types.SimpleNamespace(client=types.SimpleNamespace(
            exceptions=types.SimpleNamespace(ConditionalCheckFailedException=RuntimeError)))

    def put_item(self, **kwargs):
        item = kwargs["Item"]
        key = (item["user_id"], item["project_hash"])
        with self.lock:
            if key in self.items:
                raise RuntimeError("ConditionalCheckFailed")
            self.items[key] = copy.deepcopy(item)

    def get_item(self, **kwargs):
        key = (kwargs["Key"]["user_id"], kwargs["Key"]["project_hash"])
        with self.lock:
            return {"Item": copy.deepcopy(self.items[key])} if key in self.items else {}

    def update_item(self, **kwargs):
        key = (kwargs["Key"]["user_id"], kwargs["Key"]["project_hash"])
        with self.lock:
            self.items[key]["recording_id"] = kwargs["ExpressionAttributeValues"][":new"]


def make_recording(recording_id="recording-1", project_id="project-1", checksum=None):
    return Recording("owner", project_id, recording_id, "2026-01-01", "2026-01-01",
                     RecordingStatus.AWAITING_UPLOAD, "audio/wav",
                     f"users/owner/projects/{project_id}/recordings/{recording_id}/original.wav",
                     source_sha256=checksum)


class FakeRecordings:
    def __init__(self, items):
        self.items = {item.recording_id: item.as_item() for item in items}
        self.lock = threading.Lock()

    def get(self, user_id, recording_id, include_deleted=False):
        with self.lock:
            return copy.deepcopy(self.items[recording_id])

    def patch(self, user_id, recording_id, *, expected_revision, updates):
        with self.lock:
            item = self.items[recording_id]
            if item.get("revision", 0) != expected_revision:
                raise WriteConflictError("recording revision is stale")
            item.update(updates)
            item["revision"] = expected_revision + 1
            return copy.deepcopy(item)


class FakeStore:
    def __init__(self, items):
        self.recordings = FakeRecordings(items)
        self.project = Project("owner", "project-1", "Demo", "", "2026-01-01", "2026-01-01")

    def get_project(self, user_id, project_id):
        if project_id != self.project.project_id:
            raise ValueError("project not found")
        return self.project

    def get_recording(self, user_id, recording_id):
        return Recording.from_item(self.recordings.get(user_id, recording_id))

    def confirm_upload(self, user_id, recording_id):
        return self.get_recording(user_id, recording_id)

    def transition_recording(self, user_id, recording_id, to_status, *, expected_revision, updates=None):
        values = {"status": to_status.value, **(updates or {})}
        return Recording.from_item(self.recordings.patch(user_id, recording_id,
                                                          expected_revision=expected_revision,
                                                          updates=values))


def load_api(store, step, hashes):
    path = Path(__file__).resolve().parents[1] / "infra/lambda/api/index.py"
    spec = importlib.util.spec_from_file_location("speakup_api_process_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.payloads = lambda: store
    module.workflow_client = lambda: step
    module.recording_hashes = lambda: hashes
    return module


@pytest.fixture
def harness(monkeypatch):
    monkeypatch.setenv("STATE_MACHINE_ARN", "arn:aws:states:us-east-2:123:stateMachine:test")
    checksum = base64.b64encode(hashlib.sha256(b"audio").digest()).decode()
    store, step, hashes = FakeStore([make_recording(checksum=checksum)]), StepFunctions(), HashTable()
    api = load_api(store, step, hashes)
    event = {"routeKey": "POST /recordings/{recordingId}/process",
             "pathParameters": {"recordingId": "recording-1"},
             "requestContext": {"authorizer": {"jwt": {"claims": {"sub": "owner"}}}}}
    return api, store, step, hashes, event, checksum


def request(api, event):
    response = api.handler(event, None)
    return response["statusCode"], json.loads(response["body"])


def test_repeat_returns_same_execution_without_starting_again(harness):
    api, store, step, _, event, _ = harness
    first, second = request(api, event), request(api, event)
    assert first == second and first[0] == 202 and len(step.calls) == 1
    assert store.get_recording("owner", "recording-1").execution_start_status == "STARTED"


def test_concurrent_requests_start_only_one_execution(harness):
    api, _, step, _, event, _ = harness
    results = []
    threads = [threading.Thread(target=lambda: results.append(request(api, copy.deepcopy(event)))) for _ in range(2)]
    for thread in threads: thread.start()
    for thread in threads: thread.join(timeout=5)
    assert sorted(status for status, _ in results) == [202, 202]
    assert len(step.executions) == 1
def test_failed_start_remains_retryable_with_same_execution_name(harness):
    api, store, step, _, event, _ = harness
    step.fail_once = True
    with pytest.raises(RuntimeError): api._dispatch(event)
    assert store.get_recording("owner", "recording-1").execution_start_status == "PENDING"
    assert request(api, event)[0] == 202
    assert [call["name"] for call in step.calls] == ["recording-1", "recording-1"]


def test_lost_start_response_reconciles_completed_execution(harness):
    api, store, step, _, event, _ = harness
    step.ack_lost_once = True
    with pytest.raises(RuntimeError): api._dispatch(event)
    assert request(api, event)[0] == 202 and len(step.executions) == 1
    assert store.get_recording("owner", "recording-1").execution_start_status == "STARTED"


def test_terminal_state_does_not_retry_pending_start(harness):
    api, store, step, _, event, _ = harness
    step.fail_once = True
    with pytest.raises(RuntimeError): api._dispatch(event)
    store.recordings.items["recording-1"]["status"] = "FAILED"
    assert request(api, event)[0] == 200 and len(step.calls) == 1


def test_same_project_duplicate_is_rejected_and_distinct_project_is_allowed(harness):
    api, store, step, _, event, checksum = harness
    assert request(api, event)[0] == 202
    duplicate = make_recording("recording-2", checksum=checksum)
    store.recordings.items["recording-2"] = duplicate.as_item()
    event["pathParameters"]["recordingId"] = "recording-2"
    status, body = request(api, event)
    assert status == 409 and body["duplicate_recording_id"] == "recording-1"
    other = make_recording("recording-3", "project-2", checksum)
    store.recordings.items["recording-3"] = other.as_item()
    event["pathParameters"]["recordingId"] = "recording-3"
    assert request(api, event)[0] == 202 and len(step.executions) == 2


def test_concurrent_duplicate_claims_allow_one_execution(harness):
    api, store, step, _, event, checksum = harness
    store.recordings.items["recording-2"] = make_recording("recording-2", checksum=checksum).as_item()
    results, events = [], []
    for recording_id in ("recording-1", "recording-2"):
        item = copy.deepcopy(event)
        item["pathParameters"]["recordingId"] = recording_id
        events.append(item)
    threads = [threading.Thread(target=lambda item=item: results.append(request(api, item))) for item in events]
    for thread in threads: thread.start()
    for thread in threads: thread.join(timeout=5)
    assert sorted(status for status, _ in results) == [202, 409]
    assert len(step.executions) == 1
