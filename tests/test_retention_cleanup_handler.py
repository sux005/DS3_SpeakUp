"""Tests for bounded sparse-index retention cleanup."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest


HANDLER_PATH = Path(__file__).parents[1] / "infra/lambda/retention_cleanup/index.py"


def load_handler():
    spec = importlib.util.spec_from_file_location("retention_cleanup_test", HANDLER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cleanup_queries_due_index_and_processes_bounded_batch(monkeypatch):
    module = load_handler()
    queried = []
    query_count = {"value": 0}
    def query(**kwargs):
        queried.append(kwargs)
        query_count["value"] += 1
        return {"Items": [{"user_id": "u", "recording_id": "r"}]} if query_count["value"] == 1 else {"Items": []}
    table = SimpleNamespace(query=query)
    calls = []
    monkeypatch.setattr(module, "recordings_table", lambda: table)
    monkeypatch.setattr(module, "payloads", lambda: SimpleNamespace(
        cleanup_expired_recording=lambda user, recording: calls.append((user, recording)) or 1
    ))
    assert module.handler({}, None) == {"cleaned": 1, "failed": 0}
    assert calls == [("u", "r")]
    assert queried and queried[0]["IndexName"] == "MaintenanceDueIndex"


def test_cleanup_continues_then_fails_when_one_item_errors(monkeypatch):
    module = load_handler()
    query_count = {"value": 0}
    def query(**kwargs):
        query_count["value"] += 1
        return {"Items": [
            {"user_id": "u", "recording_id": "bad"},
            {"user_id": "u", "recording_id": "good"},
        ]} if query_count["value"] == 1 else {"Items": []}
    table = SimpleNamespace(query=query)
    calls = []
    def cleanup(user, recording):
        calls.append(recording)
        if recording == "bad":
            raise RuntimeError("temporary failure")
        return 1
    monkeypatch.setattr(module, "recordings_table", lambda: table)
    monkeypatch.setattr(module, "payloads", lambda: SimpleNamespace(cleanup_expired_recording=cleanup))
    with pytest.raises(RuntimeError, match="1 cleanup items failed"):
        module.handler({}, None)
    assert calls == ["bad", "good"]


def test_failed_cleanup_is_rescheduled_after_strong_reread(monkeypatch):
    module = load_handler()
    old_key = "2020-01-01T00:00:00Z#USER#u#RECORDING#bad"
    updates = []
    table = SimpleNamespace(
        query=lambda **kwargs: {"Items": [{
            "user_id": "u", "recording_id": "bad",
            "maintenance_due_at_recording_id": old_key,
        }]} if not updates else {"Items": []},
        get_item=lambda **kwargs: {"Item": {
            "user_id": "u", "recording_id": "bad", "status": "FAILED",
            "maintenance_partition": "CLEANUP#0",
            "maintenance_due_at_recording_id": old_key,
        }},
        update_item=lambda **kwargs: updates.append(kwargs),
    )
    monkeypatch.setattr(module, "recordings_table", lambda: table)
    monkeypatch.setattr(module, "payloads", lambda: SimpleNamespace(
        cleanup_expired_recording=lambda *args: (_ for _ in ()).throw(RuntimeError("temporary"))
    ))
    with pytest.raises(RuntimeError):
        module.handler({}, None)
    assert updates and updates[0]["ExpressionAttributeValues"][":old_due"] == old_key


def test_cleanup_rotates_start_shard_and_persists_cursor(monkeypatch):
    module = load_handler()
    saved = []
    queries = []
    cursor = SimpleNamespace(
        get_item=lambda **kwargs: {"Item": {"cursor_id": "cleanup-shard", "next_shard": 3}},
        put_item=lambda **kwargs: saved.append(kwargs),
    )
    table = SimpleNamespace(query=lambda **kwargs: queries.append(kwargs) or {"Items": []})
    monkeypatch.setattr(module, "cleanup_cursor_table", lambda: cursor)
    monkeypatch.setattr(module, "recordings_table", lambda: table)
    assert module._due_cleanup_items(2, module._start_shard())[1] == 3
    assert queries
    module._save_start_shard(4)
    assert saved[-1]["Item"]["next_shard"] == 4


def test_cleanup_stops_before_lambda_deadline(monkeypatch):
    module = load_handler()
    calls = []
    table = SimpleNamespace(query=lambda **kwargs: {"Items": [
        {"user_id": "u", "recording_id": "r"},
    ]} if not calls else {"Items": []})
    monkeypatch.setattr(module, "recordings_table", lambda: table)
    monkeypatch.setattr(module, "payloads", lambda: SimpleNamespace(
        cleanup_expired_recording=lambda *args: calls.append(args) or 1
    ))
    context = SimpleNamespace(get_remaining_time_in_millis=lambda: 100)
    assert module.handler({}, context) == {"cleaned": 0, "failed": 0}
    assert calls == []
