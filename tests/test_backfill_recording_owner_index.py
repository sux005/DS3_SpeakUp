from scripts.backfill_recording_owner_index import index_values


def test_index_values_builds_owner_scoped_keys():
    assert index_values(
        {
            "user_id": "user-1",
            "project_id": "project-1",
            "recording_id": "recording-1",
            "created_at": "2026-10-27T12:00:00Z",
        }
    ) == (
        "USER#user-1#PROJECT#project-1",
        "2026-10-27T12:00:00Z#RECORDING#recording-1",
    )


def test_index_values_rejects_incomplete_legacy_item():
    assert index_values({"user_id": "user-1"}) is None
