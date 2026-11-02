# AWS payload package reference

This is the complete usage reference for `src.aws_payload`, SpeakUp's internal
Python API for project metadata, recording lifecycle state, original audio, and
versioned processing artifacts. It is a backend API, not an HTTP or browser API.

For storage design, migration, IAM, and operational decisions, see
[`aws-payload-api.md`](aws-payload-api.md). For a shorter orientation, see the
[`src/aws_payload` README](../src/aws_payload/README.md).

## Which layer should I call?

| Caller | Use | Reason |
|---|---|---|
| Lambda handlers and backend workflows | `SpeakUpPayloadStore` | Enforces owner checks and coordinates S3 with DynamoDB. |
| Package tests and specialized infrastructure code | `S3PayloadStore`, `ProjectRepository`, `RecordingRepository` | Exposes one storage system at a time; callers must preserve the facade's invariants. |
| Package implementation only | `keys`, `serialization`, `AwsClientFactory` | Low-level validation, encoding, and client construction. |

Application code should import the stable public API from `src.aws_payload`.
Direct imports from submodules are appropriate only for the lower-level adapter
and helper APIs documented later in this reference.

```python
from src.aws_payload import (
    PayloadType,
    RecordingStatus,
    SpeakUpPayloadStore,
    WriteConflictError,
)

payloads = SpeakUpPayloadStore.from_environment()
```

Do not accept bucket names, table names, S3 keys, `PayloadRef` objects, or owner
IDs from an untrusted client. The authenticated backend supplies `user_id`; the
package derives and validates storage keys.

## Configuration

### `PayloadConfig`

`PayloadConfig` is immutable and contains resource names and bounded behavior
settings. It deliberately contains no credentials. Boto3 uses its normal
credential chain for local profiles or workload credentials.

```python
from src.aws_payload import PayloadConfig, SpeakUpPayloadStore

config = PayloadConfig(
    region="us-east-2",
    data_bucket="speakup-dev-data-123456789012",
    projects_table="speakup-dev-projects",
    recordings_table="speakup-dev-recordings",
)
payloads = SpeakUpPayloadStore(config)
```

| Field | Default | Allowed values / purpose |
|---|---:|---|
| `region` | required | Valid AWS Region name; all Regional resources must be in the project's selected Region. |
| `data_bucket` | required | Valid private S3 bucket name. |
| `projects_table` | required | DynamoDB projects table. |
| `recordings_table` | required | DynamoDB recordings table. |
| `owner_project_index` | `OwnerProjectCreatedAtIndex` | GSI used to list recordings within one owner/project scope. |
| `upload_url_ttl_seconds` | `900` | Presigned URL lifetime, 60-3600 seconds. |
| `recovery_days` | `30` | Soft-delete recovery window, 1-365 days. |
| `abandoned_retention_days` | `7` | Age before abandoned/failed cleanup, 1-30 days. |
| `max_json_payload_bytes` | `1,048,576` | Non-transcript JSON limit, 1 KiB-10 MiB. |
| `max_transcript_payload_bytes` | `5,242,880` | Transcript limit, at least the general JSON limit and at most 50 MiB. |
| `connect_timeout_seconds` | `5` | AWS SDK connection timeout, 1-30 seconds. |
| `read_timeout_seconds` | `60` | AWS SDK read timeout, 1-300 seconds. |
| `sdk_total_max_attempts` | `3` | Adaptive retry attempts including the first request, 1-10. |
| `sdk_max_pool_connections` | `10` | Shared SDK connection-pool size, 1-100. |

Invalid values raise `PayloadConfigurationError` during construction.

### `PayloadConfig.from_environment(environment=None) -> PayloadConfig`

Builds validated configuration from a mapping or, when omitted, `os.environ`.
Passing a mapping is useful in tests and does not modify process environment.

| Environment variable | Required | Default |
|---|---|---|
| `AWS_REGION` (fallback: `AWS_DEFAULT_REGION`) | yes | none |
| `DATA_BUCKET` | yes | none |
| `PROJECTS_TABLE` | yes | none |
| `RECORDINGS_TABLE` | yes | none |
| `OWNER_PROJECT_INDEX` | no | `OwnerProjectCreatedAtIndex` |
| `URL_EXPIRY_SECONDS` | no | `900` |
| `PAYLOAD_RECOVERY_DAYS` | no | `30` |
| `ABANDONED_RETENTION_DAYS` | no | `7` |
| `MAX_JSON_PAYLOAD_BYTES` | no | `1048576` |
| `MAX_TRANSCRIPT_PAYLOAD_BYTES` | no | `5242880` |
| `AWS_CONNECT_TIMEOUT_SECONDS` | no | `5` |
| `AWS_READ_TIMEOUT_SECONDS` | no | `60` |
| `AWS_TOTAL_MAX_ATTEMPTS` | no | `3` |
| `AWS_MAX_POOL_CONNECTIONS` | no | `10` |

## Recommended API: `SpeakUpPayloadStore`

### Construction

#### `SpeakUpPayloadStore(config, *, factory=None, projects=None, recordings=None, objects=None)`

Creates the facade. In production, pass only `config`; dependency parameters
exist so tests can inject fakes. The object lazily creates and reuses boto3
clients and table resources, so create it once per runtime rather than once per
record inside a loop.

#### `SpeakUpPayloadStore.from_environment() -> SpeakUpPayloadStore`

Loads `PayloadConfig.from_environment()` and returns a ready facade. Raises
`PayloadConfigurationError` before any AWS call if configuration is absent or
invalid.

### Projects

#### `create_project(user_id, *, project_title, description="", project_id=None) -> Project`

Creates one project under the authenticated owner.

- `user_id`: opaque authenticated subject; 1-64 letters, digits, `_`, or `-`.
- `project_title`: trimmed to 200 characters; blank becomes `Untitled project`.
- `description`: converted to text and truncated to 2,000 characters.
- `project_id`: optional validated ID; a UUID is generated when omitted.
- Returns the canonical `Project` written to DynamoDB.
- Raises `IdentifierValidationError` for unsafe IDs and
  `WriteConflictError` if the owner/project key already exists.

Projects do not store `recording_count` or a recording-ID array. Recording
membership is queried from the owner-scoped GSI, avoiding an unbounded and
contentious project item.

#### `get_project(user_id, project_id) -> Project`

Strongly reads an active project from exactly the supplied owner partition.
Returns `Project`; raises `PayloadNotFoundError` for a missing, deleted, or
differently owned project.

#### `list_projects(user_id, *, limit=50, cursor=None) -> RepositoryPage[Project]`

Queries one owner's project partition without a table scan.

- `limit`: page size from 1 through 100.
- `cursor`: opaque `next_cursor` from the immediately preceding page for the
  same owner. Do not decode or modify it.
- Returns `RepositoryPage(items, next_cursor)`.
- Raises `ValueError` for an invalid limit and `PayloadValidationError` for an
  invalid, corrupt, or cross-scope cursor.

```python
cursor = None
while True:
    page = payloads.list_projects(user_id, limit=25, cursor=cursor)
    for project in page.items:
        process(project)
    cursor = page.next_cursor
    if cursor is None:
        break
```

### Upload reservation and confirmation

#### `reserve_upload(user_id, project_id, content_type, *, idempotency_key, recording_id=None) -> tuple[Recording, UploadIntent]`

Verifies project ownership, transactionally creates recording metadata, and
returns a short-lived presigned PUT reservation.

- Supported `content_type` values: `audio/wav`, `audio/x-wav`, `audio/mpeg`,
  `audio/mp4`, and `audio/x-m4a`.
- `idempotency_key` must contain 1-36 letters, digits, `_`, or `-`. A request
  retry with identical input returns the existing recording.
- Reusing an idempotency key or recording ID with different input raises
  `IdempotencyConflictError`.
- `recording_id` is optional. When omitted, a deterministic UUIDv5 is derived
  from owner, project, and idempotency key.
- Returns `(Recording, UploadIntent)`. The recording starts in
  `AWAITING_UPLOAD` at revision 0.

The uploader must send every `UploadIntent.required_headers` pair exactly as
returned. This includes content type, the immutable-write condition, SSE-S3,
and ownership metadata. Do not log `upload_url`.

```python
recording, upload = payloads.reserve_upload(
    user_id,
    project_id,
    "audio/wav",
    idempotency_key=request_id,
)

# Return upload.upload_url and dict(upload.required_headers) only to the
# authenticated client that owns this recording.
```

#### `confirm_upload(user_id, recording_id) -> Recording`

After the client PUT completes, checks the exact S3 object, content type, and
ownership scope, attaches an `original-audio.v1` reference, and transitions the
recording to `UPLOADED`.

If the recording has already left `AWAITING_UPLOAD`, the current recording is
returned unchanged, making confirmation safe to retry. Missing objects raise
`PayloadNotFoundError`; mismatched content metadata raises
`PayloadIntegrityError`; stale concurrent writes raise `WriteConflictError`.

### Recording reads and lifecycle

#### `get_recording(user_id, recording_id) -> Recording`

Strongly reads one visible recording under the authenticated owner. Soft-deleted
and differently owned records appear not found.

#### `list_recordings(user_id, project_id, *, limit=50, cursor=None) -> RepositoryPage[Recording]`

Verifies project ownership, queries the owner/project GSI newest-first, and then
strongly re-reads each base-table record. The second read prevents recently
deleted records from leaking through an eventually consistent index.

`limit` is 1-100. `cursor` is opaque and scoped to this owner/project. The
method returns `RepositoryPage[Recording]` and never scans the table.

#### `transition_recording(user_id, recording_id, to_status, *, expected_revision, updates=None) -> Recording`

Moves a recording through the validated processing state machine using
optimistic concurrency.

- `to_status` must be a `RecordingStatus`, not an arbitrary string.
- `expected_revision` must equal the record's current revision. Every successful
  mutation increments the revision by one.
- `updates` may attach small workflow metadata but must not overwrite protected
  identity, index, deletion, or revision fields.
- Raises `PayloadValidationError` for an illegal transition and
  `WriteConflictError` for a stale revision.

| From | Allowed next states |
|---|---|
| `AWAITING_UPLOAD` | `UPLOADED`, `FAILED` |
| `UPLOADED` | `PROCESSING`, `FAILED` |
| `PROCESSING` | `TRANSCRIBING`, `ANALYZED`, `COMPLETE`, `FAILED` |
| `TRANSCRIBING` | `ANALYZED`, `FAILED` |
| `ANALYZED` | `COMPLETE`, `FAILED` |
| `FAILED` | `PROCESSING` |
| `COMPLETE` | none |

`DELETED` and `PURGE_PENDING` are controlled by deletion methods, not this
transition method.

### JSON artifacts

#### `put_json_artifact(user_id, recording_id, *, payload_type, producer, producer_version, artifact_name, data, expected_revision) -> tuple[Recording, PayloadRef]`

Wraps application `data` in the versioned SpeakUp envelope, encodes canonical
UTF-8 JSON, immutably writes it to S3, and attaches its compact `PayloadRef` to
recording metadata.

- Pass only the application body in `data`; do not pre-wrap an envelope.
- `payload_type` is a `PayloadType` and selects both the reference slot and size
  limit. Transcripts default to 5 MiB; other JSON defaults to 1 MiB.
- `producer`, `producer_version`, and `artifact_name` are safe key segments:
  1-128 characters, beginning alphanumeric, followed by alphanumeric, `.`, `_`,
  or `-`; `..` is rejected.
- `expected_revision` protects the metadata attachment from lost updates.
- Returns the updated `Recording` and immutable `PayloadRef`.

The write is S3-first. If S3 succeeds but the DynamoDB revision update loses a
race, call `reconcile_json_artifact` with the new current revision.

#### `reconcile_json_artifact(user_id, recording_id, *, payload_type, producer, producer_version, artifact_name, expected_revision) -> tuple[Recording, PayloadRef] | None`

Finds a deterministic JSON object left by an interrupted S3-first write and
attaches it to recording metadata. Returns `None` if the object does not exist.
It validates the stored payload type and still requires the current revision.

#### `get_json_artifact(user_id, recording_id, payload_type) -> dict[str, Any]`

Owner-checks the recording, reads the referenced JSON with a bounded stream,
validates checksum and envelope, and returns the full envelope. Application data
is under `result["data"]`.

```python
envelope = payloads.get_json_artifact(
    user_id, recording_id, PayloadType.TRANSCRIPT
)
segments = envelope["data"]["segments"]
```

Raises `PayloadNotFoundError` when the recording has no reference and
`PayloadIntegrityError` or `JsonValidationError` when stored data is invalid.

### Audio and general payload reads

#### `create_original_download_url(user_id, recording_id, *, expires_in=None) -> str`

Strongly owner-checks the recording, then creates a presigned GET URL for its
original audio. `expires_in` defaults to the configured URL TTL and must be
60-3600 seconds. Return it only to the authenticated owner and never log it.

#### `open_payload(user_id, recording_id, payload_type) -> AbstractContextManager[BinaryIO]`

Owner-checks a referenced payload and returns a context manager over its S3
stream. Always use `with`; leaving a streaming body open can hold an SDK HTTP
connection.

```python
with payloads.open_payload(
    user_id, recording_id, PayloadType.ORIGINAL_AUDIO
) as body:
    while chunk := body.read(1024 * 1024):
        consume(chunk)
```

#### `download_payload(user_id, recording_id, payload_type, destination) -> None`

Owner-checks the reference and downloads it with boto3's managed transfer
implementation. `destination` is a local `str` or `Path`. Prefer this method to
manual streaming when a workflow needs a complete local file because managed
transfers handle multipart behavior and retries.

### Deletion and cleanup

#### `soft_delete(user_id, recording_id, *, expected_revision) -> Recording`

Marks the recording `DELETED`, removes its GSI attributes so lists hide it, and
starts the configured recovery window. S3 objects remain intact. Repeating a
completed soft delete returns the deleted record; a stale first attempt raises
`WriteConflictError`.

#### `recover(user_id, recording_id, *, expected_revision) -> Recording`

Restores a soft-deleted recording before `recovery_until`, including its GSI
keys and prior status. Raises `PayloadValidationError` when it is not deleted or
the recovery window expired, and `WriteConflictError` for stale revisions.

#### `permanently_delete(user_id, recording_id, *, expected_revision, confirmation, purge_token) -> int`

Stages `PURGE_PENDING`, deletes every S3 version and delete marker under the
validated recording prefix, then conditionally removes DynamoDB metadata.

- The recording must first be soft-deleted.
- `confirmation` must exactly equal `recording_id`.
- `purge_token` is a caller-generated stable non-empty token for retries.
- Returns the number of S3 versions and delete markers removed.
- A retry of a staged purge reuses the stored token and continues safely.

This operation is irreversible. It does not delete an entire project or scan
for work.

#### `cleanup_expired_recording(user_id, recording_id, *, now=None) -> int | None`

Idempotently evaluates one known record supplied by a backend maintenance
workflow. Only `AWAITING_UPLOAD` or `FAILED` recordings older than
`abandoned_retention_days` are purged. Returns the number of S3 entries removed,
or `None` when the record is ineligible or too recent.

The method does not scan DynamoDB and does not schedule itself. A bounded queue
or scheduler must supply candidate owner/recording pairs. `now` exists for
deterministic tests; production callers normally omit it.

## Models and enums

All models are frozen dataclasses. Treat them as immutable snapshots; after a
write, use the newly returned model because its revision has changed.

### `PayloadType`

| Member | Stored value | Use |
|---|---|---|
| `ORIGINAL_AUDIO` | `original-audio.v1` | Original client upload. |
| `TRANSCRIPT` | `transcript.v1` | Timestamped transcript. |
| `SPEECH_ANALYSIS` | `speech-analysis.v1` | Derived diagnostics and metrics. |
| `FEEDBACK` | `feedback.v1` | Coaching result. |
| `ARTIFACT_MANIFEST` | `artifact-manifest.v1` | Output inventory. |
| `AUDIO_PREP_ARTIFACT` | `audio-prep-artifact.v1` | Prepared audio file. |
| `PREPROCESS_REPORT` | `preprocess-report.v1` | Audio preparation report. |

### `RecordingStatus`

The members are `AWAITING_UPLOAD`, `UPLOADED`, `PROCESSING`, `TRANSCRIBING`,
`ANALYZED`, `COMPLETE`, `FAILED`, `DELETED`, and `PURGE_PENDING`. Use
`transition_recording` or the deletion methods rather than assigning statuses.

### `PayloadRef`

Fields: `user_id`, `project_id`, `recording_id`, `key`, `payload_type`,
`content_type`, `content_length`, `sha256`, `producer`, `producer_version`,
`schema_version=1`, optional `etag`, and optional `version_id`.

#### `PayloadRef.as_dict() -> dict[str, Any]`

Returns a JSON- and
DynamoDB-compatible mapping, omitting empty optional version/ETag values. A
reference is metadata, not authorization; the facade still performs an owner
read before serving it.

### `UploadIntent`

Fields: `user_id`, `project_id`, `recording_id`, `key`, `content_type`,
`expires_at`, `upload_url`, and `required_headers`. The URL and headers together
form the upload request. The URL is sensitive bearer-style data until it
expires.

### `Project`

Fields: `user_id`, `project_id`, `project_title`, `description`, `created_at`,
`updated_at`, `schema_version=1`, and `revision=0`.

#### `Project.as_item() -> dict[str, Any]`

Returns the DynamoDB representation without any derived recording counter or
recording-ID array.

#### `Project.from_item(item) -> Project`

Reads current or legacy items and fills backward-compatible defaults.

There is intentionally no `recording_count` field.

### `Recording`

Fields: `user_id`, `project_id`, `recording_id`, `created_at`, `updated_at`,
`status`, `content_type`, `original_s3_key`, `schema_version`, `revision`, and
`payload_refs`.

#### `Recording.as_item() -> dict[str, Any]`

Returns the DynamoDB representation and writes the legacy `audio_s3_key` alias
during migration.

#### `Recording.from_item(item) -> Recording`

Reads current or legacy items, including legacy `COMPLETED` and `audio_s3_key`
values.

### `RepositoryPage[T]`

A frozen page with `items: tuple[T, ...]` and `next_cursor: str | None`. Cursors
are opaque, scope-bound continuation tokens. Pass one only to the same list
method with the same owner/project scope.

## Stable exceptions

Catch the narrowest useful exception. All package-domain exceptions inherit
`PayloadError`; configuration and validation errors also inherit `ValueError`.

| Exception | Meaning / caller action |
|---|---|
| `PayloadError` | Base for the stable package exception family. |
| `PayloadConfigurationError` | Required configuration is missing or unsafe; fix deployment/runtime configuration. |
| `PayloadValidationError` | Domain input, state transition, cursor, or operation is invalid; reject the request. |
| `IdentifierValidationError` | An ID or key segment is unsafe. |
| `JsonValidationError` | JSON is malformed, noncanonical, too deep, duplicated, non-finite, or violates its envelope. |
| `PayloadTooLargeError` | Encoded JSON exceeds its configured byte limit. |
| `PayloadNotFoundError` | Metadata or S3 payload is absent, deleted, or outside the caller's visible owner scope. |
| `PayloadAlreadyExistsError` | A deterministic immutable key already contains different data. |
| `WriteConflictError` | The expected revision is stale; re-read and decide whether to retry. |
| `IdempotencyConflictError` | An idempotency identity was reused with different input. |
| `OwnershipViolationError` | A key/reference is outside its declared recording prefix. Treat as a security failure. |
| `PayloadIntegrityError` | Stored content, checksum, metadata, or purge result is inconsistent. Quarantine/escalate rather than silently continuing. |
| `BackendUnavailableError` | Reserved stable type for a backend availability failure. Current adapters generally let unexpected boto3/botocore errors propagate. |

Low-level AWS failures that the package cannot convert actionably may propagate
as `botocore.exceptions.ClientError`. Handle those at the workflow or handler
boundary for logging/retry policy; do not swallow them in business logic.

## Lower-level S3 adapter: `S3PayloadStore`

Use this adapter only when implementing package integrations. It validates key
scope but does not perform the facade's DynamoDB owner read.

### Construction

`S3PayloadStore(config, client)` accepts `PayloadConfig` and a reusable boto3 S3
client.

### `create_upload_intent(user_id, project_id, recording_id, content_type) -> UploadIntent`

Builds an immutable original-audio key and presigned conditional PUT with
SSE-S3 and ownership metadata. It validates IDs and permits only the supported
audio media types. Callers must send every required header.

### `confirm_original(user_id, project_id, recording_id, key, content_type) -> PayloadRef`

Checks that `key` is the exact derived original key, heads the object, and
validates content type. Returns the original-audio reference. It does not decode
audio bytes or calculate a checksum that the client did not upload.

### `put_json(..., payload_type, producer, producer_version, artifact_name, document) -> PayloadRef`

Expects a complete versioned envelope, encodes canonical JSON, computes SHA-256,
and performs an S3 conditional put (`If-None-Match: *`) with SSE-S3. An identical
retry returns the existing reference; different bytes at the same deterministic
key raise `PayloadAlreadyExistsError`.

Facade callers should use `put_json_artifact`, which creates the envelope and
attaches the reference transactionally with revision protection.

### `put_file(source, *, user_id, project_id, recording_id, payload_type, producer, producer_version, artifact_name, content_type) -> PayloadRef`

Hashes a local audio file, uploads it with boto3's managed transfer API, and
returns a reference based on the resulting S3 metadata. `source` is a `str` or
`Path`; supported content types are the package's audio types. Unlike JSON
writes, this method is not conditional, so deterministic producer/version/name
selection is the caller's versioning contract.

### `get_json(reference) -> dict[str, Any]`

Validates reference scope, bounds the read based on payload type, closes the S3
stream, validates the envelope, and verifies SHA-256 when present. Returns the
full envelope.

### `find_json(..., payload_type, producer, producer_version, artifact_name) -> PayloadRef | None`

Heads the deterministic JSON key for reconciliation. Returns `None` when absent
and raises `PayloadIntegrityError` if its stored payload type conflicts.

### `open_stream(reference) -> Iterator[BinaryIO]`

A context manager that validates reference scope, yields the S3 `StreamingBody`,
and always closes it. It honors `version_id` when present.

### `download_file(reference, destination) -> None`

Validates the reference and uses boto3's managed download transfer, including a
specific `version_id` when present.

### `create_download_url(reference, *, expires_in=None) -> str`

Signs a GET URL for 60-3600 seconds. This method assumes the service layer has
already owner-checked the reference; application code should call
`SpeakUpPayloadStore.create_original_download_url` instead.

### `purge_recording(user_id, project_id, recording_id) -> int`

Paginates every object version and delete marker below the exact validated
recording prefix, deletes in batches of at most 1,000, verifies that S3 reported
no per-object errors, and returns the number removed.

## Lower-level DynamoDB repositories

Repositories return native Python dictionaries because they use the boto3
DynamoDB resource interface. Most application code should use the typed facade.

### `TableLike`

This structural protocol documents the subset of a boto3 DynamoDB `Table` used
by repositories: `name`, `meta`, and the `get_item`, `put_item`, `query`,
`update_item`, and `delete_item` methods. Test doubles can implement this small
surface without emulating the complete boto3 resource. These methods accept the
same keyword arguments and mapping responses as their boto3 counterparts.

### Repository implementation exceptions

Direct repository users may see these narrower subclasses. They are deliberately
not part of the package-root import surface; application code should catch their
stable parents shown in the exception table above.

| Repository exception | Stable parent | Condition |
|---|---|---|
| `RepositoryError` | `PayloadError` | Base for repository-specific expected failures, including corrupt stored timestamps. |
| `RecordNotFoundError` | `PayloadNotFoundError` | Owner-scoped metadata was not found or is hidden. |
| `RecordConflictError` | `WriteConflictError` | A conditional create or purge token collided. |
| `RevisionConflictError` | `WriteConflictError` | An optimistic revision condition failed. |
| `InvalidTransitionError` | `PayloadValidationError` | A lifecycle/deletion transition is not permitted. |
| `InvalidCursorError` | `PayloadValidationError` | A cursor is malformed or belongs to another query scope. |
| `RecoveryExpiredError` | `PayloadValidationError` | The recovery deadline has passed. |

### `ProjectRepository(table)`

#### `create(project) -> dict[str, Any]`

Conditionally creates one project. It requires `user_id` and `project_id`,
removes obsolete recording counters/arrays, and supplies schema/revision
defaults. Conflicts are exposed as `PayloadAlreadyExistsError` through the
public exception mapping.

#### `get(user_id, project_id, *, include_deleted=False) -> dict[str, Any]`

Strongly reads one owner/project key. Deleted records are hidden unless the
internal maintenance flag is true.

#### `list(user_id, *, limit=50, cursor=None) -> RepositoryPage[dict[str, Any]]`

Strongly queries one owner's partition newest-first and filters deleted items.
It never scans. The opaque cursor is cryptographically untrusted but structurally
validated and bound to this query scope.

### `RecordingRepository(recordings_table, projects_table, *, transaction_client=None, index_name="OwnerProjectCreatedAtIndex", recovery_days=30)`

The repository coordinates recording metadata and project existence. A
transaction client may be injected for tests; otherwise it uses the recordings
table resource's native-type client.

#### `create(recording, *, idempotency_key, idempotency_fingerprint) -> dict[str, Any]`

Uses a DynamoDB transaction to confirm the active owner/project and create the
recording exactly once. An identical replay returns the existing item; a changed
replay raises `IdempotencyConflictError`.

#### `get(user_id, recording_id, *, include_deleted=False) -> dict[str, Any]`

Strongly reads one owner/recording key. Deleted rows are hidden by default.

#### `list_for_project(user_id, project_id, *, limit=50, cursor=None) -> RepositoryPage[dict[str, Any]]`

Queries the owner-scoped GSI newest-first, then strongly re-reads and filters
base records. This costs additional reads but protects ownership and deletion
visibility despite GSI eventual consistency.

#### `transition(user_id, recording_id, to_status, *, expected_revision, updated_at, updates=None) -> dict[str, Any]`

Validates the state-machine edge and conditionally updates status, optional
metadata, timestamp, and revision.

#### `patch(user_id, recording_id, *, expected_revision, updates) -> dict[str, Any]`

Conditionally updates non-lifecycle metadata. Deleted and purge-pending rows are
immutable. Field names must be simple identifiers and protected identity/index
fields cannot be changed by ordinary updates.

#### `soft_delete(user_id, recording_id, *, expected_revision, now=None) -> dict[str, Any]`

Stores prior status and recovery timestamps, removes GSI keys, and marks the row
`DELETED`. `now` is a test clock override.

#### `recover(user_id, recording_id, *, expected_revision, now=None) -> dict[str, Any]`

Restores status and GSI keys within the recovery window. It rejects active,
purge-pending, or expired rows.

#### `stage_permanent_delete(user_id, recording_id, *, expected_revision, purge_token, now=None) -> dict[str, Any]`

Moves an already soft-deleted row to `PURGE_PENDING`. An identical token is
idempotent; a different concurrent token conflicts.

#### `finalize_permanent_delete(user_id, recording_id, *, expected_revision, purge_token) -> None`

Conditionally deletes metadata only if status, revision, and purge token still
match the staged operation. Call only after S3 purge succeeds.

### Repository helpers

- `owner_project_key(user_id, project_id) -> str`: alias of the validated GSI
  partition-key constructor; returns `USER#{user}#PROJECT#{project}`.
- `recording_created_key(created_at, recording_id) -> str`: alias of the GSI
  chronological sort-key constructor.
- `utc_now() -> datetime`: timezone-aware current UTC time.
- `format_timestamp(value) -> str`: converts a datetime to the package's
  lexically sortable millisecond UTC `...Z` form.

Repository-specific implementation errors are mapped to the stable public
exception family at the package boundary. Prefer importing exceptions from
`src.aws_payload`, not from `repositories`.

## Key helpers

Keys are deterministic and ownership-scoped. Do not concatenate S3 paths in
application code.

### `validate_identifier(value, name) -> str`

Returns an opaque ID containing 1-64 letters, digits, `_`, or `-`; otherwise
raises `IdentifierValidationError`.

### `validate_key_segment(value, name) -> str`

Returns a backend-controlled producer/version/artifact segment containing
1-128 safe characters. It must start alphanumeric; `.`, `_`, and `-` are
allowed afterward; dot traversal is rejected.

### `extension_for_content_type(content_type) -> str`

Normalizes an approved media type and returns `json`, `wav`, `mp3`, or `m4a`.
Unsupported values raise `PayloadValidationError`.

### `recording_prefix(user_id, project_id, recording_id) -> str`

Returns:

```text
users/{user}/projects/{project}/recordings/{recording}/
```

### `original_audio_key(user_id, project_id, recording_id, content_type) -> str`

Returns the prefix plus `original.wav`, `original.mp3`, or `original.m4a`.
JSON and other non-audio content types are rejected.

### `artifact_key(..., producer, producer_version, artifact_name, content_type) -> str`

Returns:

```text
users/{user}/projects/{project}/recordings/{recording}/artifacts/
  {producer}/{producer_version}/{artifact_name}.{extension}
```

All IDs and segments are validated before construction.

### `legacy_preprocess_key(..., pipeline_version, filename) -> str`

Builds the read-compatible legacy path under
`preprocess/{pipeline_version}/{filename}`. New artifacts should use
`artifact_key`.

### `require_owned_key(key, user_id, project_id, recording_id) -> str`

Returns the key only when it is under the exact recording prefix and matches an
approved original, artifact, or legacy layout. Otherwise raises
`OwnershipViolationError`.

### `owner_project_id(user_id, project_id) -> str`

Builds the recordings GSI partition value
`USER#{user}#PROJECT#{project}` after validating both IDs.

### `created_at_recording_id(created_at, recording_id) -> str`

Builds the GSI sort value `{UTC timestamp}#RECORDING#{recording}`. The timestamp
must be ISO-8601 UTC with a trailing `Z`.

## JSON helpers

JSON payloads must be UTF-8 top-level objects. Object keys must be strings;
duplicates, non-finite numbers, unsupported Python values, and nesting deeper
than 32 levels are rejected.

### `dumps_canonical_json(document, max_bytes) -> bytes`

Validates and deterministically encodes a mapping with sorted keys, compact
separators, Unicode preserved, and no NaN/infinity. The limit applies to encoded
UTF-8 bytes, not Python character count.

### `loads_json_object(data, max_bytes, *, expected_payload_type=None) -> dict[str, Any]`

Strictly decodes bytes-like UTF-8 data, rejects duplicate keys and invalid
numbers, enforces the byte/depth contracts, and optionally validates a SpeakUp
envelope against a `PayloadType` or stored type string.

### `make_envelope(payload_type, *, producer, producer_version, data, created_at=None) -> dict[str, Any]`

Returns schema version 1 with `payload_type`, producer identity, a millisecond
UTC timestamp (or supplied timestamp), and a copy of application `data`.

### `validate_envelope(document, expected_payload_type) -> None`

Requires fields `schema_version`, `payload_type`, `producer`,
`producer_version`, `created_at`, and dictionary `data`; accepts only schema
version 1 and the expected payload type.

## AWS client factory

`AwsClientFactory(config, *, session=None, s3_client=None, dynamodb_resource=None)`
creates shared, lazy boto3 objects. Production uses the standard credential
chain; injected sessions/clients support tests.

- `s3_client`: cached S3 client configured for SigV4, adaptive retries,
  timeouts, and bounded connection pooling.
- `dynamodb_resource`: cached DynamoDB resource using native Python values.
- `projects_table`: configured projects `Table` resource.
- `recordings_table`: configured recordings `Table` resource.

Do not create a factory/client inside record-processing loops.

`utc_timestamp() -> str` in `service.py` returns the package's current
lexically sortable millisecond UTC timestamp.

## Complete backend workflow

```python
from pathlib import Path
import uuid

from src.aws_payload import PayloadType, RecordingStatus, SpeakUpPayloadStore

payloads = SpeakUpPayloadStore.from_environment()

# user_id comes from verified authentication, never from request JSON.
project = payloads.create_project(
    user_id,
    project_title="Weekly practice",
    description="Prepared speech diagnostics",
)

recording, upload = payloads.reserve_upload(
    user_id,
    project.project_id,
    "audio/wav",
    idempotency_key=str(uuid.uuid4()),
)

# The authenticated client PUTs to upload.upload_url using exactly
# dict(upload.required_headers). The backend confirms after PUT success.
recording = payloads.confirm_upload(user_id, recording.recording_id)

recording = payloads.transition_recording(
    user_id,
    recording.recording_id,
    RecordingStatus.PROCESSING,
    expected_revision=recording.revision,
)

payloads.download_payload(
    user_id,
    recording.recording_id,
    PayloadType.ORIGINAL_AUDIO,
    Path("work/input.wav"),
)

recording, transcript_ref = payloads.put_json_artifact(
    user_id,
    recording.recording_id,
    payload_type=PayloadType.TRANSCRIPT,
    producer="transcriber",
    producer_version="1.0.0",
    artifact_name="transcript",
    data={"segments": [{"start": 0.0, "end": 1.2, "text": "Hello"}]},
    expected_revision=recording.revision,
)

recording = payloads.transition_recording(
    user_id,
    recording.recording_id,
    RecordingStatus.COMPLETE,
    expected_revision=recording.revision,
)

transcript = payloads.get_json_artifact(
    user_id, recording.recording_id, PayloadType.TRANSCRIPT
)["data"]
```

## Common mistakes

- Do not call the S3 adapter from an HTTP handler; use the facade so ownership
  is strongly checked first.
- Do not trust `user_id`, raw S3 keys, or `PayloadRef` values supplied by a
  client.
- Do not log audio/transcript content, presigned URLs, or credentials.
- Do not reuse a stale `Recording.revision`; use the model returned by the last
  successful mutation.
- Do not pre-envelope `put_json_artifact` data; it creates the envelope.
- Do not treat `get_json_artifact` as returning only application data; select
  its `"data"` field.
- Do not leave `open_payload` streams open; always use a `with` block.
- Do not construct keys with string concatenation; use key helpers.
- Do not use table scans for project recording lists; use `list_recordings`.
- Do not run permanent deletion without an explicit user action and stable
  purge token.

## Local validation

Package unit and contract tests run with the repository suite:

```powershell
python -m pytest -q --basetemp .test-tmp -p no:cacheprovider
```

The optional Moto integration test is skipped when Moto is not installed. Unit
tests do not require deployed AWS resources or credentials.
