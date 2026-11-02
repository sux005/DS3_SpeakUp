# DynamoDB payload metadata design

The projects table uses `(user_id, project_id)`. The recordings table uses
`(user_id, recording_id)`. Neither project item stores `recording_count` or a
recording ID array; those fields are ignored on legacy reads and never written.

A project item contains only project metadata, for example:

```json
{
  "user_id": "user_123",
  "project_id": "project_456",
  "project_title": "Research Presentation",
  "created_at": "2026-10-10T14:30:00Z",
  "updated_at": "2026-10-10T15:00:00Z",
  "description": "Practice recordings for my presentation"
}
```

Each recording stores its own `project_id`; the project item never embeds
recording references. To list a project's recordings, query the recordings
index using the authenticated `user_id` and requested `project_id`.

`OwnerProjectCreatedAtIndex` uses:

- partition: `USER#{user_id}#PROJECT#{project_id}`
- sort: `{created_at}#RECORDING#{recording_id}`

This makes the main application list query owner-scoped at the key level. The
index includes only status, update time, content type, and schema version in
addition to keys. Results are strongly batch-read from the base table before
they are returned, preventing a stale soft-deleted row from leaking through the
eventually consistent index. The list query refills a page after filtering
deleted rows.

Creates use a transaction that verifies the owner project and conditionally
writes the recording. Idempotency fingerprints distinguish retries from key
reuse. Mutations increment `revision` under a condition. Legacy rows without
`schema_version` or `revision` read as version zero.

Soft deletion removes both GSI attributes and records `deleted_at`,
`recovery_until`, and the prior status. Recovery restores the index keys.
Permanent deletion is a staged operation so DynamoDB metadata remains available
if S3 version cleanup fails and needs a retry.

On-demand billing avoids idle provisioned capacity. The correctness batch-read
increases read capacity use per list page. `MaintenanceDueIndex` is a sparse,
eight-shard index over `maintenance_partition` and
`maintenance_due_at_recording_id`. Active workflows and retention-eligible rows
receive due keys; completed rows do not. Maintenance workers query due shards,
strongly reread each base row, and conditionally reschedule retries. During
migration, discovery runs in `dual` mode so legacy rows remain reachable. Run
`scripts/backfill_maintenance_index.py` to populate missing keys, audit its
counts and conflicts, then switch to `index` mode in a later rollout.

`WorkflowAdmissionsTable` stores an owner-scoped set of active recording IDs.
Transitions into and out of active states update that set in the same DynamoDB
transaction as the recording status. The admission limit remains disabled until
legacy active rows are backfilled and audited; new transitions populate the set
even during this bootstrap period. `GET /account/limits` exposes the current
count and whether enforcement is enabled.
