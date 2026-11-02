# AWS payload API implementation plan

## Outcome

Build a backend-only Python API that gives SpeakUp one owner-scoped interface
for project metadata, recording state, audio objects, and versioned JSON
artifacts. S3 remains the source of truth for audio and large payloads;
DynamoDB remains the source of truth for metadata, ownership, lifecycle state,
and listing recordings by project.

This implementation targets the AWS project's selected Region (`us-east-2`).
It does not deploy resources or run a data backfill automatically.

## Approved architecture

- The package is internal Python code under `src/aws_payload`.
- Projects do not store `recording_count` or a recording ID array.
- Recordings are listed through `OwnerProjectCreatedAtIndex`, keyed by the
  authenticated owner and project.
- Objects use S3-managed encryption (SSE-S3), TLS-only access, bucket-owner
  ownership, versioning, and backend-generated object keys.
- Active originals, selected processing artifacts, and approved JSON remain
  available. Failed or abandoned uploads are eligible for cleanup after seven
  days. A normal delete hides a recording immediately and allows recovery for
  30 days. Permanent deletion removes all versions under the exact recording
  prefix.
- Authenticated public API routes may return short-lived, owner-checked
  pre-signed GET URLs. The storage package itself is not a public API.
- JSON payloads are canonical UTF-8 top-level objects. The default limit is
  1 MiB; timestamped transcripts may use up to 5 MiB.
- CloudTrail S3 data events and S3 access logs are deferred initially to avoid
  unnecessary MVP cost. Structured application logs, built-in service metrics,
  finite log retention, and minimal alarms remain the initial observability
  layer.

## Workstreams and ownership

### 1. Package foundation

Owned files: models, configuration, exceptions, key builders, canonical JSON,
AWS client factory, package exports, foundation tests, and package README.

Acceptance goals:

- Immutable typed models and stable domain exceptions.
- Strict ID, environment, content-type, and payload validation.
- Deterministic keys with no caller-controlled bucket, table, or raw key.
- Duplicate-key, malformed UTF-8, non-finite number, depth, and size checks for
  JSON.
- Reused boto3 clients with adaptive retries and bounded timeouts.

### 2. S3 adapter

Owned files: S3 store, S3 tests, and S3 design documentation.

Acceptance goals:

- SSE-S3 managed upload/download and object verification.
- Streaming bodies always close.
- Pre-signed uploads and downloads are short-lived and narrowly scoped.
- Permanent purge lists and deletes every version and delete marker under one
  validated recording prefix only.
- Expected S3 failures become stable domain errors; unexpected failures remain
  visible to callers.

### 3. DynamoDB repositories

Owned files: project/recording repositories, repository tests, and DynamoDB
design documentation.

Acceptance goals:

- Strong owner checks for mutations and owner-scoped GSI listing.
- Idempotent recording reservation, optimistic revisions, and validated status
  transitions.
- Opaque query cursors cannot be reused for another owner or project.
- Soft delete, recovery, and permanent-delete staging are explicit states.
- Legacy records without schema or revision fields remain readable.

### 4. Integration, migration, and release validation

Owned by the primary agent: service facade, Lambda integration, CloudFormation,
IAM, migration scripts, packaging, top-level documentation, and the complete
test/validation pass.

Acceptance goals:

- One `SpeakUpPayloadStore` facade enforces ownership before storage access.
- Existing routes remain compatible, while project recording listing,
  confirmation, playback, soft deletion, recovery, and permanent deletion are
  added.
- The application dual-writes the new GSI attributes. Infrastructure adds the
  new GSI without removing the old index in the same deployment.
- A dry-run-by-default backfill script prepares legacy rows. Old-index removal
  is a later, explicit cutover after verification.
- IAM permissions are generated/reviewed from the implemented boto3 calls and
  scoped to this stack's bucket, tables, index, and workflow.
- Unit and Stubber tests run without AWS credentials. Real AWS integration is
  opt-in and restricted to isolated resources in `us-east-2`.

## Release gates

1. Foundation, S3, and repository test suites pass independently.
2. Integrated API and handler tests pass without network access.
3. The full pytest suite and Python compilation pass.
4. CloudFormation passes local schema validation; compliance and account-aware
   validation are reported separately if their tools or AWS session are
   unavailable.
5. Documentation covers API contracts, errors, consistency, retention,
   security, costs, migration, packaging, deployment, and cleanup.
6. No deployment, backfill write, policy upload, or live resource mutation is
   performed without a separate explicit request.
