"""Behavior tests for idempotent post-upload processing requests."""

import copy
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import types
import unittest
from unittest.mock import patch


class ConditionalCheckFailedException(Exception):
    pass


class ExecutionAlreadyExists(Exception):
    pass


class ClientError(Exception):
    pass


class Condition:
    def __init__(self, check):
        self.check = check

    def __and__(self, other):
        return Condition(lambda item: self.check(item) and other.check(item))


class Attr:
    def __init__(self, name):
        self.name = name

    def eq(self, value):
        return Condition(lambda item: item.get(self.name) == value)

    def not_exists(self):
        return Condition(lambda item: self.name not in item)


class RecordingTable:
    def __init__(self):
        self.item = {
            "user_id": "owner",
            "recording_id": "recording-1",
            "project_id": "project-1",
            "audio_s3_key": "users/owner/projects/project-1/recordings/recording-1/original.wav",
            "status": "AWAITING_UPLOAD",
        }
        self.lock = threading.Lock()
        self.other_items = {}
        self.meta = types.SimpleNamespace(
            client=types.SimpleNamespace(
                exceptions=types.SimpleNamespace(
                    ConditionalCheckFailedException=ConditionalCheckFailedException
                )
            )
        )

    def get_item(self, **kwargs):
        with self.lock:
            recording_id = kwargs["Key"]["recording_id"]
            item = self.item if recording_id == self.item["recording_id"] else self.other_items.get(recording_id)
            return {"Item": copy.deepcopy(item)} if item else {}

    def update_item(self, **kwargs):
        with self.lock:
            recording_id = kwargs["Key"]["recording_id"]
            item = self.item if recording_id == self.item["recording_id"] else self.other_items[recording_id]
            if not kwargs["ConditionExpression"].check(item):
                raise ConditionalCheckFailedException()
            values = kwargs["ExpressionAttributeValues"]
            if ":processing" in values:
                item.update(
                    status=values[":processing"],
                    execution_arn=values[":arn"],
                    execution_name=values[":name"],
                    execution_start_status=values[":pending"],
                )
            else:
                item["execution_start_status"] = values[":started"]


class RecordingHashes:
    def __init__(self):
        self.items = {}
        self.lock = threading.Lock()
        self.meta = types.SimpleNamespace(
            client=types.SimpleNamespace(
                exceptions=types.SimpleNamespace(ConditionalCheckFailedException=ConditionalCheckFailedException)
            )
        )

    def put_item(self, **kwargs):
        item = kwargs["Item"]
        key = (item["user_id"], item["project_hash"])
        with self.lock:
            if key in self.items:
                raise ConditionalCheckFailedException()
            self.items[key] = copy.deepcopy(item)

    def get_item(self, **kwargs):
        key = (kwargs["Key"]["user_id"], kwargs["Key"]["project_hash"])
        with self.lock:
            return {"Item": copy.deepcopy(self.items[key])} if key in self.items else {}

    def update_item(self, **kwargs):
        key = (kwargs["Key"]["user_id"], kwargs["Key"]["project_hash"])
        with self.lock:
            item = self.items[key]
            if not kwargs["ConditionExpression"].check(item):
                raise ConditionalCheckFailedException()
            item["recording_id"] = kwargs["ExpressionAttributeValues"][":new"]


class StepFunctions:
    def __init__(self):
        self.exceptions = types.SimpleNamespace(
            ExecutionAlreadyExists=ExecutionAlreadyExists
        )
        self.calls = []
        self.executions = set()
        self.fail_once = False
        self.ack_lost_once = False
        self.execution_closed = False
        self.lock = threading.Lock()

    def start_execution(self, **kwargs):
        with self.lock:
            self.calls.append(kwargs)
            if self.fail_once:
                self.fail_once = False
                raise ClientError("temporary start failure")
            if self.execution_closed and (kwargs["name"], kwargs["input"]) in self.executions:
                raise ExecutionAlreadyExists()
            self.executions.add((kwargs["name"], kwargs["input"]))
            if self.ack_lost_once:
                self.ack_lost_once = False
                raise ClientError("response lost after start")
            return {"executionArn": "arn:aws:states:us-east-2:123:execution:test:recording-1"}


def load_api(recordings, recording_hashes, step_functions, s3):
    boto3 = types.ModuleType("boto3")
    boto3.client = lambda name, **kwargs: {"s3": s3, "stepfunctions": step_functions}[name]
    boto3.resource = lambda name: types.SimpleNamespace(
        Table=lambda table_name: recording_hashes if table_name == "recording-hashes" else recordings
    )
    boto3_dynamodb = types.ModuleType("boto3.dynamodb")
    conditions = types.ModuleType("boto3.dynamodb.conditions")
    conditions.Attr = Attr
    conditions.Key = Attr
    botocore = types.ModuleType("botocore")
    exceptions = types.ModuleType("botocore.exceptions")
    exceptions.ClientError = ClientError
    config = types.ModuleType("botocore.config")
    config.Config = lambda **kwargs: kwargs
    modules = {
        "boto3": boto3,
        "boto3.dynamodb": boto3_dynamodb,
        "boto3.dynamodb.conditions": conditions,
        "botocore": botocore,
        "botocore.exceptions": exceptions,
        "botocore.config": config,
    }
    path = Path(__file__).resolve().parents[1] / "infra/lambda/api/index.py"
    spec = importlib.util.spec_from_file_location("speakup_api_process_test", path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules), patch.dict(
        os.environ,
        {
            "PROJECTS_TABLE": "projects",
            "RECORDINGS_TABLE": "recordings",
            "RECORDING_HASHES_TABLE": "recording-hashes",
            "DATA_BUCKET": "bucket",
            "STATE_MACHINE_ARN": "arn:aws:states:us-east-2:123:stateMachine:test",
        },
    ):
        spec.loader.exec_module(module)
    return module


class ProcessRouteTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(
            os.environ,
            {
                "STATE_MACHINE_ARN": "arn:aws:states:us-east-2:123:stateMachine:test",
                "URL_EXPIRY_SECONDS": "900",
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.recordings = RecordingTable()
        self.recording_hashes = RecordingHashes()
        self.step_functions = StepFunctions()
        self.s3 = types.SimpleNamespace(head_object=lambda **kwargs: {})
        self.api = load_api(self.recordings, self.recording_hashes, self.step_functions, self.s3)
        self.event = {
            "routeKey": "POST /recordings/{recordingId}/process",
            "pathParameters": {"recordingId": "recording-1"},
            "requestContext": {"authorizer": {"jwt": {"claims": {"sub": "owner"}}}},
        }

    def request(self):
        response = self.api.handler(self.event, None)
        return response["statusCode"], json.loads(response["body"])

    def test_repeat_returns_same_execution_without_starting_again(self):
        first = self.request()
        second = self.request()
        self.assertEqual(first, second)
        self.assertEqual(first[0], 202)
        self.assertEqual(len(self.step_functions.calls), 1)
        self.assertEqual(self.recordings.item["execution_start_status"], "STARTED")

        self.recordings.item["status"] = "COMPLETE"
        terminal = self.request()
        self.assertEqual(terminal[0], 200)
        self.assertEqual(terminal[1]["execution_arn"], first[1]["execution_arn"])
        self.assertEqual(len(self.step_functions.calls), 1)

    def test_concurrent_requests_start_only_one_execution(self):
        barrier = threading.Barrier(2)
        self.s3.head_object = lambda **kwargs: barrier.wait(timeout=5)
        results = []
        errors = []

        def run():
            try:
                results.append(self.request())
            except Exception as error:
                errors.append(error)

        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=6)

        self.assertFalse(errors)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0][1]["execution_arn"], results[1][1]["execution_arn"])
        self.assertEqual(len(self.step_functions.executions), 1)
        self.assertEqual(self.recordings.item["execution_start_status"], "STARTED")

    def test_failed_start_remains_retryable_with_same_execution_name(self):
        self.step_functions.fail_once = True
        with self.assertRaises(ClientError):
            self.request()
        self.assertEqual(self.recordings.item["execution_start_status"], "PENDING")

        retried = self.request()
        self.assertEqual(retried[0], 202)
        self.assertEqual(len(self.step_functions.calls), 2)
        self.assertEqual(
            self.step_functions.calls[0]["name"],
            self.step_functions.calls[1]["name"],
        )
        self.assertEqual(self.recordings.item["execution_start_status"], "STARTED")

    def test_lost_start_response_reconciles_completed_execution(self):
        self.step_functions.ack_lost_once = True
        with self.assertRaises(ClientError):
            self.request()
        self.step_functions.execution_closed = True

        retried = self.request()
        self.assertEqual(retried[0], 202)
        self.assertEqual(len(self.step_functions.executions), 1)
        self.assertEqual(self.recordings.item["execution_start_status"], "STARTED")

    def test_terminal_state_does_not_retry_pending_start(self):
        self.step_functions.fail_once = True
        with self.assertRaises(ClientError):
            self.request()
        self.recordings.item["status"] = "FAILED"

        status, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "FAILED")
        self.assertEqual(len(self.step_functions.calls), 1)

    def test_same_project_exact_duplicate_is_rejected_but_distinct_audio_processes(self):
        first_hash = base64.b64encode(hashlib.sha256(b"first audio").digest()).decode()
        second_hash = base64.b64encode(hashlib.sha256(b"second audio").digest()).decode()
        self.recordings.item["source_sha256"] = first_hash
        second = {
            **self.recordings.item,
            "recording_id": "recording-2",
            "audio_s3_key": "users/owner/projects/project-1/recordings/recording-2/original.wav",
            "source_sha256": first_hash,
        }
        self.recordings.other_items["recording-2"] = second
        self.s3.head_object = lambda **kwargs: {
            "ChecksumSHA256": self.recordings.get_item(
                Key={"recording_id": kwargs["Key"].split("/")[-2]}
            )["Item"]["source_sha256"]
        }

        first = self.request()
        self.event["pathParameters"]["recordingId"] = "recording-2"
        duplicate = self.request()
        self.assertEqual(first[0], 202)
        self.assertEqual(duplicate[0], 409)
        self.assertEqual(duplicate[1]["duplicate_recording_id"], "recording-1")
        self.assertEqual(len(self.step_functions.executions), 1)

        third = {
            **self.recordings.item,
            "recording_id": "recording-3",
            "audio_s3_key": "users/owner/projects/project-1/recordings/recording-3/original.wav",
            "source_sha256": second_hash,
            "status": "AWAITING_UPLOAD",
        }
        for field in ("execution_arn", "execution_name", "execution_start_status"):
            third.pop(field, None)
        self.recordings.other_items["recording-3"] = third
        self.event["pathParameters"]["recordingId"] = "recording-3"
        distinct = self.request()
        self.assertEqual(distinct[0], 202)
        self.assertEqual(len(self.step_functions.executions), 2)

        fourth = {
            **second,
            "recording_id": "recording-4",
            "project_id": "project-2",
            "audio_s3_key": "users/owner/projects/project-2/recordings/recording-4/original.wav",
        }
        self.recordings.other_items["recording-4"] = fourth
        self.event["pathParameters"]["recordingId"] = "recording-4"
        separate_project = self.request()
        self.assertEqual(separate_project[0], 202)
        self.assertEqual(len(self.step_functions.executions), 3)

    def test_mismatched_s3_checksum_cannot_claim_audio(self):
        self.recordings.item["source_sha256"] = base64.b64encode(hashlib.sha256(b"expected").digest()).decode()
        self.s3.head_object = lambda **kwargs: {"ChecksumSHA256": "different"}
        status, body = self.request()
        self.assertEqual(status, 409)
        self.assertIn("does not match", body["message"])
        self.assertEqual(len(self.recording_hashes.items), 0)
        self.assertEqual(len(self.step_functions.calls), 0)

    def test_two_recordings_with_same_audio_race_to_one_execution(self):
        checksum = base64.b64encode(hashlib.sha256(b"same audio").digest()).decode()
        self.recordings.item["source_sha256"] = checksum
        second = {
            **self.recordings.item,
            "recording_id": "recording-2",
            "audio_s3_key": "users/owner/projects/project-1/recordings/recording-2/original.wav",
        }
        self.recordings.other_items["recording-2"] = second
        barrier = threading.Barrier(2)

        def head(**kwargs):
            barrier.wait(timeout=5)
            return {"ChecksumSHA256": checksum}

        self.s3.head_object = head
        results = []
        errors = []

        def run(recording_id):
            event = copy.deepcopy(self.event)
            event["pathParameters"]["recordingId"] = recording_id
            try:
                response = self.api.handler(event, None)
                results.append((response["statusCode"], json.loads(response["body"])))
            except Exception as error:
                errors.append(error)

        threads = [threading.Thread(target=run, args=(name,)) for name in ("recording-1", "recording-2")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=6)

        self.assertFalse(errors)
        self.assertEqual(sorted(status for status, _ in results), [202, 409])
        self.assertEqual(len(self.step_functions.executions), 1)

    def test_invalid_checksum_is_rejected(self):
        self.assertIsNone(self.api.sha256_hex("not-a-checksum"))
        self.assertIsNone(self.api.sha256_hex(None))
        valid = base64.b64encode(hashlib.sha256(b"audio").digest()).decode()
        self.assertEqual(self.api.sha256_hex(valid), hashlib.sha256(b"audio").hexdigest())

    def test_upload_url_binds_the_checksum_and_returns_required_headers(self):
        checksum = base64.b64encode(hashlib.sha256(b"audio").digest()).decode()
        self.api.projects = types.SimpleNamespace(get_item=lambda **kwargs: {"Item": {"project_id": "project-1"}})
        inserted = []
        self.api.recordings.put_item = lambda **kwargs: inserted.append(kwargs["Item"])
        signed = []
        self.s3.generate_presigned_url = lambda operation, **kwargs: signed.append((operation, kwargs)) or "https://example.invalid/upload"
        self.event["routeKey"] = "POST /uploads"
        self.event["body"] = json.dumps({"project_id": "project-1", "content_type": "audio/wav", "sha256": checksum})

        status, body = self.request()
        self.assertEqual(status, 201)
        self.assertEqual(inserted[0]["source_sha256"], checksum)
        self.assertEqual(signed[0][1]["Params"]["ChecksumSHA256"], checksum)
        self.assertEqual(body["upload_headers"]["x-amz-checksum-sha256"], checksum)

        self.recording_hashes.put_item(
            Item={"user_id": "owner", "project_hash": f"project-1#{hashlib.sha256(b'audio').hexdigest()}", "recording_id": inserted[0]["recording_id"]},
            ConditionExpression="attribute_not_exists(project_hash)",
        )
        self.recordings.other_items[inserted[0]["recording_id"]] = {**inserted[0], "status": "COMPLETE"}
        status, duplicate = self.request()
        self.assertEqual(status, 409)
        self.assertEqual(duplicate["duplicate_recording_id"], inserted[0]["recording_id"])
        self.assertEqual(len(inserted), 1)

        self.event["body"] = json.dumps({"project_id": "project-1", "content_type": "audio/wav", "sha256": "bad"})
        status, _ = self.request()
        self.assertEqual(status, 400)
        self.assertEqual(len(inserted), 1)


if __name__ == "__main__":
    unittest.main()
