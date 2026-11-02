from types import SimpleNamespace
from datetime import datetime, timezone

import pytest

from scripts.backfill_maintenance_index import CURSOR_ID, backfill
from src.aws_payload.repositories import maintenance_values


class ConditionalFailure(Exception):
    pass


class Table:
    name = "recordings"

    def __init__(self, items, last_key=None):
        self.items = items
        self.last_key = last_key
        self.writes = []
        self.transactions = []
        self.meta = SimpleNamespace(client=SimpleNamespace(
            exceptions=SimpleNamespace(ConditionalCheckFailedException=ConditionalFailure),
            transact_write_items=self.transact_write_items,
        ))

    def scan(self, **kwargs):
        return {"Items": self.items, **({"LastEvaluatedKey": self.last_key} if self.last_key else {})}

    def update_item(self, **kwargs):
        self.writes.append(kwargs)

    def transact_write_items(self, **kwargs):
        self.transactions.append(kwargs)


class Admissions(Table):
    name = "admissions"


class Cursor:
    def __init__(self, item=None):
        self.item = item
        self.writes = []
        self.deletes = []

    def get_item(self, **kwargs):
        return {"Item": self.item} if self.item else {}

    def put_item(self, **kwargs):
        self.writes.append(kwargs)

    def delete_item(self, **kwargs):
        self.deletes.append(kwargs)


def row(status="PROCESSING", **extra):
    return {
        "user_id": "user-1", "recording_id": "recording-1", "project_id": "project-1",
        "status": status, "updated_at": "2026-01-01T00:00:00Z", **extra,
    }


def test_dry_run_reports_work_without_writes():
    recordings = Table([row()])
    admissions = Admissions([])
    cursor = Cursor()
    result = backfill(recordings, admissions, cursor, apply=False)
    assert result.scanned == 1
    assert result.indexed == 1
    assert result.admissions == 1
    assert recordings.writes == []
    assert admissions.writes == []
    assert cursor.writes == []


def test_dry_run_reads_all_scan_pages_without_advancing_cursor():
    class PagedTable(Table):
        def __init__(self):
            super().__init__([])
            self.pages = [
                ([row(recording_id="first")], {"recording_id": "first"}),
                ([row(recording_id="second")], None),
            ]

        def scan(self, **kwargs):
            items, last_key = self.pages.pop(0)
            return {"Items": items, **({"LastEvaluatedKey": last_key} if last_key else {})}

    recordings = PagedTable()
    cursor = Cursor()
    result = backfill(recordings, Admissions([]), cursor, apply=False)
    assert result.scanned == 2
    assert cursor.writes == []
    assert cursor.deletes == []


def test_dry_run_ignores_apply_cursor_and_starts_at_table_beginning():
    class CursorAwareTable(Table):
        def __init__(self):
            super().__init__([row()])
            self.exclusive_keys = []

        def scan(self, **kwargs):
            self.exclusive_keys.append(kwargs.get("ExclusiveStartKey"))
            return {"Items": self.items}

    recordings = CursorAwareTable()
    cursor = Cursor({"cursor_id": CURSOR_ID, "last_key": {"recording_id": "later"}})
    backfill(recordings, Admissions([]), cursor, apply=False)
    assert recordings.exclusive_keys == [None]


def test_dry_run_rejects_non_advancing_scan_cursor():
    class StuckTable(Table):
        def __init__(self):
            super().__init__([row()])
            self.scan_count = 0

        def scan(self, **kwargs):
            self.scan_count += 1
            return {"Items": self.items, "LastEvaluatedKey": {"recording_id": "same"}}

    recordings = StuckTable()
    with pytest.raises(RuntimeError, match="cursor did not advance"):
        backfill(recordings, Admissions([]), Cursor(), apply=False)
    assert recordings.scan_count == 2


def test_apply_writes_maintenance_admission_and_cursor():
    recordings = Table([row()], last_key={"user_id": "user-1", "recording_id": "recording-1"})
    admissions = Admissions([])
    cursor = Cursor()
    result = backfill(recordings, admissions, cursor, apply=True)
    assert result.indexed == 1
    assert len(recordings.transactions) == 1
    operations = recordings.transactions[0]["TransactItems"]
    assert operations[0]["Update"]["ExpressionAttributeValues"][":partition"].startswith("WORKFLOW#")
    assert operations[1]["Update"]["ExpressionAttributeValues"][":ids"] == {"recording-1"}
    assert cursor.writes[0]["Item"]["cursor_id"] == CURSOR_ID


def test_resume_uses_cursor_and_clears_at_end():
    recordings = Table([row(status="COMPLETE")])
    admissions = Admissions([])
    cursor = Cursor({"cursor_id": CURSOR_ID, "last_key": {"user_id": "old", "recording_id": "old"}})
    result = backfill(recordings, admissions, cursor, apply=True)
    assert result.scanned == 1
    assert cursor.deletes == [{"Key": {"cursor_id": CURSOR_ID}}]


def test_existing_conflicting_maintenance_keys_are_not_overwritten():
    recordings = Table([row(maintenance_partition="CLEANUP#1", maintenance_due_at_recording_id="old")])
    result = backfill(recordings, Admissions([]), Cursor(), apply=True)
    assert result.conflicts == 1
    assert recordings.writes == []


def test_repeated_apply_is_idempotent_for_current_index():
    values = maintenance_values("user-1", "recording-1", "PROCESSING", "2026-01-01T00:00:00Z")
    recordings = Table([row(**values)])
    result = backfill(recordings, Admissions([]), Cursor(), apply=True)
    assert result.already_current == 1
    assert result.indexed == 0


def test_terminal_rows_do_not_get_admission_membership():
    recordings = Table([row(status="FAILED")])
    admissions = Admissions([])
    result = backfill(recordings, admissions, Cursor(), apply=True)
    assert result.admissions == 0
    assert admissions.writes == []


def test_legacy_cleanup_due_includes_migration_grace_period():
    recordings = Table([row(status="FAILED")])
    result = backfill(
        recordings, Admissions([]), Cursor(), apply=False,
        legacy_cleanup_grace_hours=24,
    )
    assert result.indexed == 1
    # The derived key is visible in dry-run only through the shared calculation;
    # verify the implementation's write shape with a matching apply run.
    backfill(
        recordings, Admissions([]), Cursor(), apply=True,
        legacy_cleanup_grace_hours=24,
        migration_started_at=datetime(2026, 1, 8, tzinfo=timezone.utc),
    )
    due = recordings.writes[0]["ExpressionAttributeValues"][":due"]
    assert due.startswith("2026-01-09T00:00:00")


def test_very_old_cleanup_due_is_anchored_to_migration_time():
    recordings = Table([row(status="FAILED")])
    backfill(
        recordings, Admissions([]), Cursor(), apply=True,
        legacy_cleanup_grace_hours=24,
        migration_started_at=datetime(2026, 11, 1, tzinfo=timezone.utc),
    )
    due = recordings.writes[0]["ExpressionAttributeValues"][":due"]
    assert due.startswith("2026-11-02T00:00:00")


def test_active_backfill_uses_status_and_revision_conditions():
    recordings = Table([row(revision=4)])
    backfill(recordings, Admissions([]), Cursor(), apply=True)
    condition = recordings.transactions[0]["TransactItems"][0]["Update"]["ConditionExpression"]
    values = recordings.transactions[0]["TransactItems"][0]["Update"]["ExpressionAttributeValues"]
    assert "#status=:status" in condition
    assert values[":revision"] == 4
