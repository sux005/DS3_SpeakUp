from types import SimpleNamespace
from botocore.exceptions import ClientError

import pytest
from boto3.dynamodb.conditions import ConditionBase

from src.aws_payload.repositories import (
    ProjectRepository,
    RecordingRepository,
    _decode_cursor,
    _encode_cursor,
    InvalidTransitionError,
    WorkflowAdmissionRepository,
)
from src.aws_payload.errors import ActiveWorkflowLimitError, WriteConflictError


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


class BatchTransactions(FakeTransactions):
    def __init__(self, items):
        super().__init__()
        self.items = items
        self.batch_calls = []

    def batch_get_item(self, **kwargs):
        self.batch_calls.append(kwargs)
        table_name = next(iter(kwargs["RequestItems"]))
        keys = kwargs["RequestItems"][table_name]["Keys"]
        wanted = {(key["user_id"], key["recording_id"]) for key in keys}
        return {
            "Responses": {
                table_name: [
                    dict(item)
                    for item in self.items
                    if (item["user_id"], item["recording_id"]) in wanted
                ]
            },
            "UnprocessedKeys": {},
        }


class PartialBatchTransactions(FakeTransactions):
    def __init__(self, items):
        super().__init__()
        self.items = items
        self.batch_calls = []

    def batch_get_item(self, **kwargs):
        self.batch_calls.append(kwargs)
        table_name = next(iter(kwargs["RequestItems"]))
        keys = kwargs["RequestItems"][table_name]["Keys"]
        if len(self.batch_calls) == 1:
            first = self.items[0]
            return {
                "Responses": {table_name: [
                    {key: {"S": value} for key, value in first.items()
                     if isinstance(value, str)}
                ]},
                "UnprocessedKeys": {
                    table_name: {"Keys": keys[1:], "ConsistentRead": True}
                },
            }
        second = self.items[1]
        return {
            "Responses": {table_name: [
                {key: {"S": value} for key, value in second.items()
                 if isinstance(value, str)}
            ]},
            "UnprocessedKeys": {},
        }


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


def test_project_list_refills_page_after_filtered_query_page():
    table = FakeTable("projects")
    responses = [
        {
            "Items": [{"user_id": "user-1", "project_id": "project-1"}],
            "LastEvaluatedKey": {"user_id": "user-1", "project_id": "project-1"},
        },
        {"Items": [{"user_id": "user-1", "project_id": "project-2"}]},
    ]

    def query(**kwargs):
        table.calls.append(("query", kwargs))
        return responses.pop(0)

    table.query = query
    page = ProjectRepository(table).list("user-1", limit=2)
    assert [item["project_id"] for item in page.items] == ["project-1", "project-2"]
    assert len([call for call in table.calls if call[0] == "query"]) == 2


def test_workflow_admission_claim_and_release_are_atomic_updates():
    table = FakeTable("workflow-admissions")
    admission = WorkflowAdmissionRepository(table, limit=3)
    admission.claim("user-1", "recording-1")
    update = [call for call in table.calls if call[0] == "update_item"][0][1]
    assert "active_recording_ids" in update["UpdateExpression"]
    assert update["ExpressionAttributeValues"][":limit"] == 3
    admission.release("user-1", "recording-1")
    assert len([call for call in table.calls if call[0] == "update_item"]) == 2


def test_workflow_admission_snapshot_returns_remaining_slots():
    table = FakeTable(
        "workflow-admissions",
        item={"active_recording_ids": {"r-1", "r-2"}},
    )
    admission = WorkflowAdmissionRepository(table, limit=3)
    assert admission.snapshot("user-1") == {
        "active": 2, "limit": 3, "remaining": 1
    }


def _transactional_repository(transaction):
    recordings = FakeTable(
        "recordings",
        item={
            "user_id": "user-1", "project_id": "project-1",
            "recording_id": "recording-1", "status": "UPLOADED",
            "revision": 0, "updated_at": "2026-01-01T00:00:00Z",
        },
    )
    projects = FakeTable("projects", item={"user_id": "user-1", "project_id": "project-1"})
    admissions = FakeTable("admissions")
    return RecordingRepository(
        recordings, projects, transaction_client=transaction,
        admission_table=admissions, max_active_workflows=3,
    )


@pytest.mark.parametrize("failure_index,expected", [(0, WriteConflictError), (1, ActiveWorkflowLimitError)])
def test_transactional_admission_classifies_cancellation_reason_by_operation(failure_index, expected):
    class Transaction:
        def transact_write_items(self, **kwargs):
            reasons = [{"Code": "None"}, {"Code": "None"}]
            reasons[failure_index] = {"Code": "ConditionalCheckFailed"}
            raise ClientError(
                {
                    "Error": {"Code": "TransactionCanceledException"},
                    "CancellationReasons": reasons,
                },
                "TransactWriteItems",
            )

    repository = _transactional_repository(Transaction())
    with pytest.raises(expected):
        repository.transition(
            "user-1", "recording-1", "PROCESSING",
            expected_revision=0, updated_at="2026-01-01T00:01:00Z",
        )


def test_transactional_recording_conflict_wins_when_both_operations_cancel():
    class Transaction:
        def transact_write_items(self, **kwargs):
            raise ClientError(
                {
                    "Error": {"Code": "TransactionCanceledException"},
                    "CancellationReasons": [
                        {"Code": "ConditionalCheckFailed"},
                        {"Code": "ConditionalCheckFailed"},
                    ],
                },
                "TransactWriteItems",
            )

    repository = _transactional_repository(Transaction())
    with pytest.raises(WriteConflictError):
        repository.transition(
            "user-1", "recording-1", "PROCESSING",
            expected_revision=0, updated_at="2026-01-01T00:01:00Z",
        )


def test_admission_claim_allows_repeated_member_at_capacity():
    table = FakeTable(
        "workflow-admissions",
        item={"active_recording_ids": {"recording-1", "recording-2"}},
    )
    admission = WorkflowAdmissionRepository(table, limit=2)
    admission.claim("user-1", "recording-1")
    condition = [call for call in table.calls if call[0] == "update_item"][0][1]["ConditionExpression"]
    assert "contains(active_recording_ids, :recording_id)" in condition


def test_transactional_admission_propagates_throttling():
    class Transaction:
        def transact_write_items(self, **kwargs):
            raise ClientError(
                {"Error": {"Code": "TransactionCanceledException"},
                 "CancellationReasons": [{"Code": "ProvisionedThroughputExceeded"}, {"Code": "None"}]},
                "TransactWriteItems",
            )

    repository = _transactional_repository(Transaction())
    with pytest.raises(ClientError):
        repository.transition(
            "user-1", "recording-1", "PROCESSING",
            expected_revision=0, updated_at="2026-01-01T00:01:00Z",
        )


def test_bootstrap_admission_populates_membership_without_enforcing_limit():
    class Transaction:
        def __init__(self):
            self.calls = []

        def transact_write_items(self, **kwargs):
            self.calls.append(kwargs)

    transaction = Transaction()
    recordings = FakeTable(
        "recordings",
        item={
            "user_id": "user-1", "project_id": "project-1",
            "recording_id": "recording-1", "status": "UPLOADED",
            "revision": 0,
        },
    )
    repository = RecordingRepository(
        recordings,
        FakeTable("projects", item={"user_id": "user-1", "project_id": "project-1"}),
        transaction_client=transaction,
        admission_table=FakeTable("admissions"),
        max_active_workflows=1,
        enforce_admission_limit=False,
    )
    repository.transition(
        "user-1", "recording-1", "PROCESSING",
        expected_revision=0, updated_at="2026-01-01T00:01:00Z",
    )
    admission_update = transaction.calls[0]["TransactItems"][1]["Update"]
    assert "size(active_recording_ids)" not in admission_update.get("ConditionExpression", "")


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


def test_recording_create_only_classifies_conditional_transaction_cancellation():
    project = {
        "user_id": "user-1",
        "project_id": "project-1",
    }
    recording = {
        **project,
        "recording_id": "recording-1",
        "created_at": "2026-10-27T12:00:00.000Z",
        "idempotency_key": "request-1",
        "idempotency_fingerprint": "fingerprint",
    }

    class Cancelled:
        def transact_write_items(self, **kwargs):
            raise ClientError(
                {
                    "Error": {
                        "Code": "TransactionCanceledException",
                    },
                    "CancellationReasons": [
                        {"Code": "ConditionalCheckFailed"},
                        {"Code": "None"},
                    ],
                },
                "TransactWriteItems",
            )

    recordings = FakeTable("recordings", item=recording)
    repository = RecordingRepository(
        recordings, FakeTable("projects"), transaction_client=Cancelled()
    )
    result = repository.create(
        {**project, "recording_id": "recording-1", "created_at": recording["created_at"]},
        idempotency_key="request-1",
        idempotency_fingerprint="fingerprint",
    )
    assert result["recording_id"] == "recording-1"

    class Throttled(Cancelled):
        def transact_write_items(self, **kwargs):
            raise ClientError(
                {"Error": {"Code": "TransactionCanceledException"},
                 "CancellationReasons": [
                     {"Code": "ThrottlingError"}, {"Code": "None"}
                 ]},
                "TransactWriteItems",
            )

    with pytest.raises(ClientError):
        RecordingRepository(
            recordings, FakeTable("projects"), transaction_client=Throttled()
        ).create(
            {**project, "recording_id": "recording-2", "created_at": recording["created_at"]},
            idempotency_key="request-2",
            idempotency_fingerprint="fingerprint-2",
        )


def test_transaction_cancellation_without_reasons_is_not_treated_as_conflict():
    class UnknownCancellation:
        def transact_write_items(self, **kwargs):
            raise ClientError(
                {"Error": {"Code": "TransactionCanceledException"}},
                "TransactWriteItems",
            )

    with pytest.raises(ClientError):
        RecordingRepository(
            FakeTable("recordings"), FakeTable("projects"),
            transaction_client=UnknownCancellation(),
        ).create(
            {"user_id": "user-1", "project_id": "project-1", "recording_id": "r-1",
             "created_at": "2026-10-27T12:00:00.000Z"},
            idempotency_key="request-1", idempotency_fingerprint="fingerprint",
        )


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


def test_list_recordings_batches_base_table_reads_and_fills_filtered_page():
    items = [
        {
            "user_id": "user-1", "project_id": "project-1", "recording_id": f"r-{i}",
            "created_at": f"2026-10-27T12:0{i}:00.000Z", "status": "UPLOADED",
            "revision": 1,
        }
        for i in range(3)
    ]
    items[0]["status"] = "DELETED"
    projected = [dict(item) for item in items]
    recordings = FakeTable("recordings", query_items=projected)
    batch_client = BatchTransactions(items)
    repository = RecordingRepository(
        recordings, FakeTable("projects"), transaction_client=batch_client
    )
    page = repository.list_for_project("user-1", "project-1", limit=2)
    assert [item["recording_id"] for item in page.items] == ["r-1", "r-2"]
    assert len(batch_client.batch_calls) == 1
    assert not any(name == "get_item" for name, _ in recordings.calls)


def test_batch_retry_accumulates_partial_responses_and_decodes_low_level_items():
    items = [
        {"user_id": "user-1", "project_id": "project-1", "recording_id": "r-1",
         "status": "UPLOADED", "revision": 1},
        {"user_id": "user-1", "project_id": "project-1", "recording_id": "r-2",
         "status": "UPLOADED", "revision": 1},
    ]
    recordings = FakeTable("recordings")
    batch_client = PartialBatchTransactions(items)
    repository = RecordingRepository(
        recordings, FakeTable("projects"), transaction_client=batch_client
    )
    result = repository._get_many("user-1", ["r-1", "r-2"])
    assert [item["recording_id"] for item in result] == ["r-1", "r-2"]
    assert len(batch_client.batch_calls) == 2


def test_cursor_is_bound_to_owner_project_scope():
    cursor = _encode_cursor(
        "recordings:USER#user-1#PROJECT#project-1",
        {"user_id": "user-1", "recording_id": "recording-1"},
    )
    assert _decode_cursor(
        cursor, "recordings:USER#user-1#PROJECT#project-1"
    )["recording_id"] == "recording-1"


@pytest.mark.parametrize("status", ["PROCESSING", "TRANSCRIBING", "ANALYZED"])
def test_repository_refuses_to_delete_active_workflow(status):
    item = {
        "user_id": "user-1", "project_id": "project-1",
        "recording_id": "recording-1", "created_at": "2026-10-27T12:00:00Z",
        "updated_at": "2026-10-27T12:00:00Z", "status": status,
        "revision": 0,
    }
    recordings = FakeTable("recordings", item=item)
    repository = RecordingRepository(recordings, FakeTable("projects"))
    with pytest.raises(InvalidTransitionError):
        repository.soft_delete("user-1", "recording-1", expected_revision=0)
    assert not any(name == "update_item" for name, _ in recordings.calls)


def test_soft_delete_schedules_cleanup_at_recovery_deadline():
    from datetime import datetime, timezone

    item = {
        "user_id": "user-1", "project_id": "project-1",
        "recording_id": "recording-1", "created_at": "2026-10-27T12:00:00Z",
        "updated_at": "2026-10-27T12:00:00Z", "status": "COMPLETE",
        "revision": 1,
    }
    recordings = FakeTable("recordings", item=item)
    repository = RecordingRepository(recordings, FakeTable("projects"))
    repository.soft_delete(
        "user-1", "recording-1", expected_revision=1,
        now=datetime(2026, 11, 1, tzinfo=timezone.utc),
    )
    call = next(kwargs for name, kwargs in recordings.calls if name == "update_item")
    values = call["ExpressionAttributeValues"]
    assert any(str(value).startswith("CLEANUP#") for value in values.values())
    assert any(str(value).startswith("2026-12-01T00:00:00.000Z#RECORDING#") for value in values.values())


def test_patch_ordinary_metadata_does_not_require_clock():
    item = {
        "user_id": "user-1", "project_id": "project-1",
        "recording_id": "recording-1", "created_at": "2026-10-27T12:00:00Z",
        "updated_at": "2026-10-27T12:00:00Z", "status": "COMPLETE",
        "revision": 1,
    }
    recordings = FakeTable("recordings", item=item)
    repository = RecordingRepository(recordings, FakeTable("projects"))
    repository.patch("user-1", "recording-1", expected_revision=1, updates={"summary_metrics": {"score": 1}})
    call = next(kwargs for name, kwargs in recordings.calls if name == "update_item")
    assert ":expected_revision" not in call["ExpressionAttributeValues"]
