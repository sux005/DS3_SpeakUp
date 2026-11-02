"""The terminal failure fallback must avoid logging private workflow inputs."""

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from botocore.exceptions import ClientError

from src.aws_payload.models import RecordingStatus
from src.aws_payload.errors import PayloadNotFoundError


HANDLER_PATH = Path(__file__).parents[1] / "infra/lambda/workflow_failure/index.py"


def test_failure_event_logs_only_operational_identifiers(capsys):
    spec = importlib.util.spec_from_file_location("workflow_failure_test", HANDLER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.handler(
        {
            "detail": {
                "status": "FAILED",
                "executionArn": "arn:execution:test",
                "stateMachineArn": "arn:state-machine:test",
                "input": '{"transcript_text":"private speech"}',
                "cause": "private speech",
            }
        },
        None,
    )
    logged = json.loads(capsys.readouterr().out)
    assert result == {"logged": True}
    assert logged == {
        "event": "workflow_failure",
        "status": "FAILED",
        "executionArn": "arn:execution:test",
        "stateMachineArn": "arn:state-machine:test",
    }


def load_handler():
    spec = importlib.util.spec_from_file_location("workflow_failure_test_recovery", HANDLER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def failure_event():
    return {
        "detail": {
            "status": "FAILED",
            "executionArn": "arn:execution:test",
            "stateMachineArn": "arn:state-machine:test",
            "input": json.dumps({"user_id": "user-1", "project_id": "project-1", "recording_id": "recording-1"}),
            "cause": "private transcript text must not be logged",
        }
    }


@pytest.mark.parametrize("status", ["FAILED", "TIMED_OUT", "ABORTED"])
def test_failure_event_repairs_active_recording(monkeypatch, status):
    module = load_handler()
    recording = SimpleNamespace(status=RecordingStatus.PROCESSING, revision=4, execution_arn="arn:execution:test", project_id="project-1")
    transitions = []

    class Store:
        def get_recording(self, user_id, recording_id):
            return recording

        def transition_recording(self, *args, **kwargs):
            transitions.append((args, kwargs))
            recording.status = RecordingStatus.FAILED
            return recording

    monkeypatch.setattr(module, "payloads", lambda: Store())
    event = failure_event()
    event["detail"]["status"] = status
    assert module.handler(event, None) == {"logged": True}
    assert transitions[0][0][0:3] == ("user-1", "recording-1", RecordingStatus.FAILED)
    assert transitions[0][1]["expected_revision"] == 4
    assert transitions[0][1]["updates"]["failure_reason"].startswith("Workflow failed")


def test_duplicate_failure_event_is_idempotent(monkeypatch):
    module = load_handler()
    recording = SimpleNamespace(status=RecordingStatus.PROCESSING, revision=4, execution_arn="arn:execution:test", project_id="project-1")
    transitions = []

    class Store:
        def get_recording(self, user_id, recording_id):
            return recording

        def transition_recording(self, *args, **kwargs):
            transitions.append(kwargs)
            recording.status = RecordingStatus.FAILED
            return recording

    monkeypatch.setattr(module, "payloads", lambda: Store())
    module.handler(failure_event(), None)
    module.handler(failure_event(), None)
    assert len(transitions) == 1


def test_failure_write_race_is_suppressed_when_other_writer_repaired(monkeypatch):
    module = load_handler()
    recording = SimpleNamespace(status=RecordingStatus.PROCESSING, revision=4, execution_arn="arn:execution:test", project_id="project-1")

    class Store:
        def get_recording(self, user_id, recording_id):
            return recording

        def transition_recording(self, *args, **kwargs):
            recording.status = RecordingStatus.FAILED
            raise RuntimeError("conditional write lost")

    monkeypatch.setattr(module, "payloads", lambda: Store())
    assert module.handler(failure_event(), None) == {"logged": True}


def test_failure_write_error_is_retried_when_recording_remains_active(monkeypatch):
    module = load_handler()
    recording = SimpleNamespace(status=RecordingStatus.PROCESSING, revision=4, execution_arn="arn:execution:test", project_id="project-1")

    class Store:
        def get_recording(self, user_id, recording_id):
            return recording

        def transition_recording(self, *args, **kwargs):
            raise RuntimeError("dynamodb unavailable")

    monkeypatch.setattr(module, "payloads", lambda: Store())
    with pytest.raises(RuntimeError, match="dynamodb unavailable"):
        module.handler(failure_event(), None)


def test_failure_event_leaves_complete_recording_unchanged(monkeypatch):
    module = load_handler()
    recording = SimpleNamespace(status=RecordingStatus.COMPLETE, revision=4, project_id="project-1")
    store = SimpleNamespace(
        get_recording=lambda *args: recording,
        transition_recording=lambda *args, **kwargs: pytest.fail("complete recording must not change"),
    )
    monkeypatch.setattr(module, "payloads", lambda: store)

    assert module.handler(failure_event(), None) == {"logged": True}


def test_failure_event_does_not_mutate_a_different_execution(monkeypatch):
    module = load_handler()
    recording = SimpleNamespace(
        status=RecordingStatus.PROCESSING, revision=4,
        project_id="project-1", execution_arn="arn:execution:new",
    )
    store = SimpleNamespace(
        get_recording=lambda *args: recording,
        transition_recording=lambda *args, **kwargs: pytest.fail("wrong execution must not change recording"),
    )
    monkeypatch.setattr(module, "payloads", lambda: store)
    assert module.handler(failure_event(), None) == {"logged": True}


def test_failure_event_does_not_mutate_recording_without_matching_execution(monkeypatch):
    module = load_handler()
    recording = SimpleNamespace(
        status=RecordingStatus.PROCESSING, revision=4,
        project_id="project-1", execution_arn=None,
    )
    store = SimpleNamespace(
        get_recording=lambda *args: recording,
        transition_recording=lambda *args, **kwargs: pytest.fail("unbound execution must not change recording"),
    )
    monkeypatch.setattr(module, "payloads", lambda: store)
    assert module.handler(failure_event(), None) == {"logged": True}


def test_failure_event_without_execution_arn_does_not_mutate_recording(monkeypatch):
    module = load_handler()
    event = failure_event()
    del event["detail"]["executionArn"]
    monkeypatch.setattr(
        module, "payloads",
        lambda: pytest.fail("unbound terminal event must not read metadata"),
    )
    assert module.handler(event, None) == {"logged": True}


def test_failure_event_without_project_scope_is_ignored(monkeypatch):
    module = load_handler()
    event = failure_event()
    event["detail"]["input"] = json.dumps({
        "user_id": "user-1", "recording_id": "recording-1"
    })
    monkeypatch.setattr(module, "payloads", lambda: pytest.fail("unscoped event must not read metadata"))
    assert module.handler(event, None) == {"logged": True}


def test_failure_event_does_not_mutate_recording_missing_project_scope(monkeypatch):
    module = load_handler()
    recording = SimpleNamespace(
        status=RecordingStatus.PROCESSING, revision=4,
        execution_arn="arn:execution:test",
    )
    store = SimpleNamespace(
        get_recording=lambda *args: recording,
        transition_recording=lambda *args, **kwargs: pytest.fail("missing project scope must not change recording"),
    )
    monkeypatch.setattr(module, "payloads", lambda: store)
    assert module.handler(failure_event(), None) == {"logged": True}


def test_failure_event_ignores_deleted_recording(monkeypatch):
    module = load_handler()
    store = SimpleNamespace(
        get_recording=lambda *args: (_ for _ in ()).throw(PayloadNotFoundError("deleted")),
        transition_recording=lambda *args, **kwargs: pytest.fail("deleted recording must not change"),
    )
    monkeypatch.setattr(module, "payloads", lambda: store)

    assert module.handler(failure_event(), None) == {"logged": True}


def test_failure_event_propagates_recording_read_outage(monkeypatch):
    module = load_handler()
    store = SimpleNamespace(
        get_recording=lambda *args: (_ for _ in ()).throw(RuntimeError("DynamoDB unavailable")),
    )
    monkeypatch.setattr(module, "payloads", lambda: store)

    with pytest.raises(RuntimeError, match="DynamoDB unavailable"):
        module.handler(failure_event(), None)


def test_reconcile_marks_stale_recording_failed_when_execution_is_terminal(monkeypatch):
    module = load_handler()
    stale = {
        "user_id": "user-1",
        "recording_id": "recording-1",
        "status": "PROCESSING",
        "updated_at": "2020-01-01T00:00:00Z",
        "execution_arn": "arn:execution:test",
    }
    recording = SimpleNamespace(status=RecordingStatus.PROCESSING, revision=7, project_id="project-1")
    markers = []

    class Store:
        def get_recording(self, *args):
            return recording

    class Table:
        def scan(self, **kwargs):
            assert kwargs["Limit"] == 100
            return {"Items": [stale]}

    class Cursor:
        def get_item(self, **kwargs):
            return {}

        def scan(self, **kwargs):
            return {"Items": []}

        def put_item(self, **kwargs):
            markers.append(kwargs)

        def delete_item(self, **kwargs):
            return {}

    monkeypatch.setattr(module, "payloads", lambda: Store())
    monkeypatch.setattr(module, "recordings_table", lambda: Table())
    monkeypatch.setattr(module, "reconcile_cursor_table", lambda: Cursor())
    result = module.handler({"action": "reconcile"}, None)
    assert result == {"logged": True}
    assert markers[0]["Item"]["cursor_id"] == "retry#user-1#recording-1"


def test_reconcile_leaves_stale_recording_running(monkeypatch):
    module = load_handler()
    stale = {
        "user_id": "user-1",
        "recording_id": "recording-1",
        "status": "TRANSCRIBING",
        "updated_at": "2020-01-01T00:00:00Z",
        "execution_arn": "arn:execution:test",
    }
    store = SimpleNamespace(
        get_recording=lambda *args: pytest.fail("running workflow must not be changed"),
    )
    monkeypatch.setattr(module, "payloads", lambda: store)
    monkeypatch.setattr(module, "recordings_table", lambda: SimpleNamespace(scan=lambda **kwargs: {"Items": [stale]}))
    monkeypatch.setattr(module, "reconcile_cursor_table", lambda: SimpleNamespace(get_item=lambda **kwargs: {}, scan=lambda **kwargs: {"Items": []}, put_item=lambda **kwargs: None, delete_item=lambda **kwargs: None))
    monkeypatch.setattr(module, "states_client", lambda: SimpleNamespace(describe_execution=lambda **kwargs: {"status": "RUNNING"}))
    assert module.handler({"action": "reconcile"}, None) == {"logged": True}


def test_reconcile_persists_cursor_for_next_page(monkeypatch):
    module = load_handler()
    cursor_writes = []
    cursor = SimpleNamespace(
        get_item=lambda **kwargs: {},
        scan=lambda **kwargs: {"Items": []},
        put_item=lambda **kwargs: cursor_writes.append(kwargs),
        delete_item=lambda **kwargs: None,
    )
    table = SimpleNamespace(
        scan=lambda **kwargs: {"Items": [], "LastEvaluatedKey": {"user_id": "u", "recording_id": "r"}},
    )
    monkeypatch.setattr(module, "reconcile_cursor_table", lambda: cursor)
    monkeypatch.setattr(module, "recordings_table", lambda: table)
    assert module._reconcile_stale_recordings() == 0
    assert cursor_writes[0]["Item"]["last_key"]["recording_id"] == "r"


def test_reconcile_continues_when_execution_lookup_fails(monkeypatch):
    module = load_handler()
    stale = {
        "user_id": "user-1", "recording_id": "recording-1", "status": "PROCESSING",
        "updated_at": "2020-01-01T00:00:00Z", "execution_arn": "arn:missing",
    }
    monkeypatch.setattr(module, "recordings_table", lambda: SimpleNamespace(scan=lambda **kwargs: {"Items": [stale]}))
    writes = []
    monkeypatch.setattr(module, "reconcile_cursor_table", lambda: SimpleNamespace(get_item=lambda **kwargs: {}, scan=lambda **kwargs: {"Items": []}, put_item=lambda **kwargs: writes.append(kwargs), delete_item=lambda **kwargs: None))
    states = SimpleNamespace(describe_execution=lambda **kwargs: (_ for _ in ()).throw(RuntimeError("not found")))
    monkeypatch.setattr(module, "states_client", lambda: states)
    monkeypatch.setattr(module, "payloads", lambda: SimpleNamespace(get_recording=lambda *args: pytest.fail("lookup failure must skip record")))
    assert module._reconcile_stale_recordings() == 0
    assert any(item["Item"]["cursor_id"] == "retry#user-1#recording-1" for item in writes)


@pytest.mark.parametrize("execution_status", ["RUNNING", "PENDING", "PENDING_REDRIVE", "UNKNOWN"])
def test_retry_marker_retained_for_nonterminal_or_unknown_execution(monkeypatch, execution_status):
    module = load_handler()
    marker = {"cursor_id": "retry#user-1#recording-1", "user_id": "user-1", "recording_id": "recording-1"}
    deletes = []
    recording = SimpleNamespace(status=RecordingStatus.PROCESSING, revision=1, execution_arn="arn:active", project_id="project-1")
    cursor = SimpleNamespace(delete_item=lambda **kwargs: deletes.append(kwargs), put_item=lambda **kwargs: None)
    monkeypatch.setattr(module, "payloads", lambda: SimpleNamespace(get_recording=lambda *args: recording))
    monkeypatch.setattr(module, "states_client", lambda: SimpleNamespace(describe_execution=lambda **kwargs: {"status": execution_status}))

    assert module._process_retry_marker(cursor, marker) == 0
    assert deletes == []


def test_candidate_marker_write_failure_propagates_without_advancing_scan(monkeypatch):
    module = load_handler()
    cursor = SimpleNamespace(put_item=lambda **kwargs: (_ for _ in ()).throw(RuntimeError("cursor unavailable")))
    with pytest.raises(RuntimeError, match="cursor unavailable"):
        module._record_reconcile_candidate(cursor, "user-1", "recording-1")


def test_candidate_scan_does_not_emit_record_failure_log(monkeypatch, capsys):
    module = load_handler()
    stale = {
        "user_id": "user-1", "recording_id": "recording-1", "status": "PROCESSING",
        "updated_at": "2020-01-01T00:00:00Z", "execution_arn": "arn:execution:test",
    }
    writes = []
    cursor = SimpleNamespace(
        get_item=lambda **kwargs: {},
        scan=lambda **kwargs: {"Items": []},
        put_item=lambda **kwargs: writes.append(kwargs),
        delete_item=lambda **kwargs: None,
    )
    monkeypatch.setattr(module, "reconcile_cursor_table", lambda: cursor)
    monkeypatch.setattr(module, "recordings_table", lambda: SimpleNamespace(scan=lambda **kwargs: {"Items": [stale]}))
    assert module._reconcile_stale_recordings() == 0
    assert any(item["Item"].get("candidate") for item in writes)
    assert "workflow_reconcile_record_failed" not in capsys.readouterr().out


def test_reconcile_persists_marker_when_record_repair_fails(monkeypatch):
    module = load_handler()
    stale = {
        "user_id": "user-1", "recording_id": "recording-1", "status": "PROCESSING",
        "updated_at": "2020-01-01T00:00:00Z", "execution_arn": "arn:missing",
    }
    markers = []
    cursor = SimpleNamespace(
        get_item=lambda **kwargs: {},
        scan=lambda **kwargs: {"Items": []},
        put_item=lambda **kwargs: markers.append(kwargs),
        delete_item=lambda **kwargs: None,
    )
    monkeypatch.setattr(module, "recordings_table", lambda: SimpleNamespace(scan=lambda **kwargs: {"Items": [stale]}))
    monkeypatch.setattr(module, "reconcile_cursor_table", lambda: cursor)
    monkeypatch.setattr(module, "states_client", lambda: SimpleNamespace(describe_execution=lambda **kwargs: (_ for _ in ()).throw(ClientError({"Error": {"Code": "ExecutionDoesNotExist"}}, "DescribeExecution"))))
    monkeypatch.setattr(module, "payloads", lambda: SimpleNamespace(get_recording=lambda *args: SimpleNamespace(status=RecordingStatus.PROCESSING, revision=1, project_id="project-1"), transition_recording=lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("write failed"))))
    assert module._reconcile_stale_recordings() == 0
    assert any(item["Item"]["cursor_id"] == "retry#user-1#recording-1" for item in markers)


def test_reconcile_retries_marker_and_removes_it_after_repair(monkeypatch):
    module = load_handler()
    marker = {"cursor_id": "retry#user-1#recording-1", "user_id": "user-1", "recording_id": "recording-1"}
    deleted = []
    cursor = SimpleNamespace(
        get_item=lambda **kwargs: {},
        scan=lambda **kwargs: {"Items": [marker]},
        put_item=lambda **kwargs: None,
        delete_item=lambda **kwargs: deleted.append(kwargs),
    )
    recording = SimpleNamespace(status=RecordingStatus.PROCESSING, revision=1, execution_arn="arn:missing", project_id="project-1")
    calls = {"count": 0}
    def get_recording(*args):
        calls["count"] += 1
        if calls["count"] == 1:
            return recording
        recording.status = RecordingStatus.FAILED
        return recording
    monkeypatch.setattr(module, "reconcile_cursor_table", lambda: cursor)
    monkeypatch.setattr(module, "recordings_table", lambda: SimpleNamespace(scan=lambda **kwargs: {"Items": []}))
    monkeypatch.setattr(module, "payloads", lambda: SimpleNamespace(get_recording=get_recording, transition_recording=lambda *args, **kwargs: None))
    monkeypatch.setattr(module, "states_client", lambda: SimpleNamespace(describe_execution=lambda **kwargs: (_ for _ in ()).throw(ClientError({"Error": {"Code": "ExecutionDoesNotExist"}}, "DescribeExecution"))))
    assert module._reconcile_stale_recordings() == 1
    assert {"Key": {"cursor_id": marker["cursor_id"]}} in deleted


def test_retry_marker_scan_rotates_past_first_page(monkeypatch):
    module = load_handler()
    monkeypatch.setenv("RECONCILE_RETRY_LIMIT", "2")
    markers = [{"cursor_id": f"retry#u#r{i}", "user_id": "u", "recording_id": f"r{i}"} for i in range(3)]
    writes = []
    deletes = []
    def scan(**kwargs):
        if "ExclusiveStartKey" in kwargs:
            return {"Items": markers[2:], "LastEvaluatedKey": None}
        return {"Items": markers[:2], "LastEvaluatedKey": {"cursor_id": markers[1]["cursor_id"]}}
    cursor = SimpleNamespace(
        get_item=lambda **kwargs: {"Item": writes[-1]["Item"]} if writes else {},
        scan=scan,
        put_item=lambda **kwargs: writes.append(kwargs),
        delete_item=lambda **kwargs: deletes.append(kwargs),
    )
    assert len(module._retry_markers(cursor)) == 2
    assert len(module._retry_markers(cursor)) == 1
    assert any(item.get("Key", {}).get("cursor_id") == "retry-scan" for item in deletes)


def test_reconcile_timeout_does_not_advance_partial_retry_cursor(monkeypatch):
    module = load_handler()
    monkeypatch.setenv("RECONCILE_MAX_SECONDS", "120")
    markers = [
        {"cursor_id": "retry#u#r1", "user_id": "u", "recording_id": "r1"},
        {"cursor_id": "retry#u#r2", "user_id": "u", "recording_id": "r2"},
    ]
    cursor_writes = []
    cursor_deletes = []
    cursor = SimpleNamespace(
        get_item=lambda **kwargs: {},
        scan=lambda **kwargs: {"Items": markers, "LastEvaluatedKey": {"cursor_id": "retry#u#r2"}},
        put_item=lambda **kwargs: cursor_writes.append(kwargs),
        delete_item=lambda **kwargs: cursor_deletes.append(kwargs),
    )
    clock = iter([0.0, 1.0, 100.0, 100.0])
    monkeypatch.setattr(module.time, "monotonic", lambda: next(clock))
    processed = []
    monkeypatch.setattr(module, "_process_retry_marker", lambda table, marker: processed.append(marker) or 1)
    monkeypatch.setattr(module, "reconcile_cursor_table", lambda: cursor)
    monkeypatch.setattr(module, "recordings_table", lambda: SimpleNamespace(scan=lambda **kwargs: {"Items": []}))

    assert module._reconcile_stale_recordings() == 1
    assert processed == [markers[0]]
    assert cursor_writes == []
    assert cursor_deletes == []


def test_reconcile_deadline_is_capped_below_lambda_timeout(monkeypatch):
    module = load_handler()
    monkeypatch.setenv("RECONCILE_MAX_SECONDS", "120")
    clock = iter([0.0, 91.0])
    monkeypatch.setattr(module.time, "monotonic", lambda: next(clock))
    cursor = SimpleNamespace(
        get_item=lambda **kwargs: {},
        scan=lambda **kwargs: {"Items": [], "LastEvaluatedKey": None},
        put_item=lambda **kwargs: None,
        delete_item=lambda **kwargs: None,
    )
    monkeypatch.setattr(module, "reconcile_cursor_table", lambda: cursor)
    scans = []
    monkeypatch.setattr(module, "recordings_table", lambda: SimpleNamespace(scan=lambda **kwargs: scans.append(kwargs) or {"Items": []}))
    module._reconcile_stale_recordings()
    assert scans == []


def test_reconcile_repairs_missing_execution_and_surfaces_auth_failure(monkeypatch):
    module = load_handler()
    stale = {
        "user_id": "user-1", "recording_id": "recording-1", "status": "PROCESSING",
        "updated_at": "2020-01-01T00:00:00Z", "execution_arn": "arn:missing",
    }
    recording = SimpleNamespace(status=RecordingStatus.PROCESSING, revision=1, project_id="project-1")
    repairs = []
    monkeypatch.setattr(module, "recordings_table", lambda: SimpleNamespace(scan=lambda **kwargs: {"Items": [stale]}))
    monkeypatch.setattr(module, "reconcile_cursor_table", lambda: SimpleNamespace(get_item=lambda **kwargs: {}, scan=lambda **kwargs: {"Items": []}, put_item=lambda **kwargs: None, delete_item=lambda **kwargs: None))
    monkeypatch.setattr(module, "payloads", lambda: SimpleNamespace(
        get_recording=lambda *args: recording,
        transition_recording=lambda *args, **kwargs: repairs.append(kwargs),
    ))

    def missing(**kwargs):
        raise ClientError({"Error": {"Code": "ExecutionDoesNotExist"}}, "DescribeExecution")

    monkeypatch.setattr(module, "states_client", lambda: SimpleNamespace(describe_execution=missing))
    assert module._reconcile_stale_recordings() == 0


def test_index_discovery_queues_due_rows_without_scanning_recordings(monkeypatch):
    module = load_handler()
    monkeypatch.setenv("MAINTENANCE_DISCOVERY_MODE", "index")
    queued = []
    cursor = SimpleNamespace(
        get_item=lambda **kwargs: {},
        scan=lambda **kwargs: {"Items": []},
        put_item=lambda **kwargs: queued.append(kwargs),
        delete_item=lambda **kwargs: None,
    )
    table = SimpleNamespace(query=lambda **kwargs: {
        "Items": [{"user_id": "u", "recording_id": "r"}]
    })
    monkeypatch.setattr(module, "reconcile_cursor_table", lambda: cursor)
    monkeypatch.setattr(module, "recordings_table", lambda: table)
    assert module._reconcile_stale_recordings() == 0
    assert any(item["Item"]["cursor_id"] == "retry#u#r" for item in queued)


def test_running_due_workflow_is_rescheduled_after_marker_processing(monkeypatch):
    module = load_handler()
    old_key = "2020-01-01T00:00:00Z#USER#u#RECORDING#r"
    updates = []
    table = SimpleNamespace(
        get_item=lambda **kwargs: {"Item": {
            "user_id": "u", "recording_id": "r", "status": "PROCESSING",
            "maintenance_partition": "WORKFLOW#0",
            "maintenance_due_at_recording_id": old_key,
        }},
        update_item=lambda **kwargs: updates.append(kwargs),
    )
    cursor = SimpleNamespace(delete_item=lambda **kwargs: None, put_item=lambda **kwargs: None)
    recording = SimpleNamespace(status=RecordingStatus.PROCESSING, execution_arn="arn:test", revision=1)
    monkeypatch.setattr(module, "recordings_table", lambda: table)
    monkeypatch.setattr(module, "payloads", lambda: SimpleNamespace(get_recording=lambda *args: recording))
    monkeypatch.setattr(module, "states_client", lambda: SimpleNamespace(describe_execution=lambda **kwargs: {"status": "RUNNING"}))
    assert module._process_retry_marker(cursor, {
        "cursor_id": "retry#u#r", "user_id": "u", "recording_id": "r",
        "maintenance_due_at_recording_id": old_key,
    }) == 0
    assert updates and updates[0]["ExpressionAttributeValues"][":old_due"] == old_key

