from types import SimpleNamespace

from boto3.dynamodb.conditions import ConditionBase

from src.aws_payload.repositories import (
    ProjectRepository,
    RecordingRepository,
    _decode_cursor,
    _encode_cursor,
)


class FakeTable:
    def __init__(self, name, *, item=None, query_items=()):
        self.name = name
        self.item = item
        self.query_items = list(query_items)
        self.calls = []
        self.meta = SimpleNamespace(client=SimpleNamespace())

    def put_item(self, **kwargs):
        self.calls.append(("put_item", kwargs))
        self.item = kwargs["Item"]
        return {}

    def get_item(self, **kwargs):
        self.calls.append(("get_item", kwargs))
        return {"Item": dict(self.item)} if self.item else {}

    def query(self, **kwargs):
        self.calls.append(("query", kwargs))
        return {"Items": [dict(item) for item in self.query_items]}

    def update_item(self, **kwargs):
        self.calls.append(("update_item", kwargs))
        return {"Attributes": dict(self.item or {})}

    def delete_item(self, **kwargs):
        self.calls.append(("delete_item", kwargs))
        return {}


class FakeTransactions:
    def __init__(self):
        self.calls = []

    def transact_write_items(self, **kwargs):
        self.calls.append(kwargs)
        return {}


def test_project_create_removes_derived_recording_fields():
    table = FakeTable("projects")
    repository = ProjectRepository(table)
    result = repository.create(
        {
            "user_id": "user-1",
            "project_id": "project-1",
            "project_title": "Demo",
            "recording_count": 99,
            "recording_ids": ["wrong"],
        }
    )
    assert "recording_count" not in result
    assert "recording_ids" not in result
    assert "recording_count" not in table.item


def test_recording_create_transaction_writes_owner_scoped_gsi_values():
    projects = FakeTable("projects")
    recordings = FakeTable("recordings")
    transactions = FakeTransactions()
    repository = RecordingRepository(
        recordings, projects, transaction_client=transactions
    )
    result = repository.create(
        {
            "user_id": "user-1",
            "project_id": "project-1",
            "recording_id": "recording-1",
            "created_at": "2026-10-27T12:00:00.000Z",
        },
        idempotency_key="request-1",
        idempotency_fingerprint="fingerprint",
    )
    put = transactions.calls[0]["TransactItems"][1]["Put"]["Item"]
    assert put["owner_project_id"] == "USER#user-1#PROJECT#project-1"
    assert put["created_at_recording_id"].endswith("#RECORDING#recording-1")
    assert result["revision"] == 0


def test_list_recordings_queries_owner_index_and_strongly_rechecks_rows():
    item = {
        "user_id": "user-1",
        "project_id": "project-1",
        "recording_id": "recording-1",
        "created_at": "2026-10-27T12:00:00.000Z",
        "updated_at": "2026-10-27T12:00:00.000Z",
        "status": "UPLOADED",
        "revision": 1,
    }
    recordings = FakeTable("recordings", item=item, query_items=[item])
    repository = RecordingRepository(recordings, FakeTable("projects"))
    page = repository.list_for_project("user-1", "project-1")
    assert page.items[0]["recording_id"] == "recording-1"
    query = next(call for name, call in recordings.calls if name == "query")
    assert query["IndexName"] == "OwnerProjectCreatedAtIndex"
    assert isinstance(query["KeyConditionExpression"], ConditionBase)
    get = next(call for name, call in recordings.calls if name == "get_item")
    assert get["ConsistentRead"] is True


def test_cursor_is_bound_to_owner_project_scope():
    cursor = _encode_cursor(
        "recordings:USER#user-1#PROJECT#project-1",
        {"user_id": "user-1", "recording_id": "recording-1"},
    )
    assert _decode_cursor(
        cursor, "recordings:USER#user-1#PROJECT#project-1"
    )["recording_id"] == "recording-1"
