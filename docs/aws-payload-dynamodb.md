# DynamoDB payload metadata design

The projects table uses `(user_id, project_id)`. The recordings table uses
`(user_id, recording_id)`. Neither project item stores `recording_count` or a
recording ID array; those fields are ignored on legacy reads and never written.

`OwnerProjectCreatedAtIndex` uses:

- partition: `USER#{user_id}#PROJECT#{project_id}`
- sort: `{created_at}#RECORDING#{recording_id}`

This makes the main application list query owner-scoped at the key level. The
index includes only status, update time, content type, and schema version in
addition to keys. Each result is strongly re-read from the base table before it
is returned, preventing a stale soft-deleted row from leaking through the
eventually consistent index.

Creates use a transaction that verifies the owner project and conditionally
writes the recording. Idempotency fingerprints distinguish retries from key
reuse. Mutations increment `revision` under a condition. Legacy rows without
`schema_version` or `revision` read as version zero.

Soft deletion removes both GSI attributes and records `deleted_at`,
`recovery_until`, and the prior status. Recovery restores the index keys.
Permanent deletion is a staged operation so DynamoDB metadata remains available
if S3 version cleanup fails and needs a retry.

On-demand billing avoids idle provisioned capacity. The correctness re-read
increases read requests per list page; this is preferable to projecting all
recording metadata or accepting stale deletion/ownership behavior.
