# SpeakUp AWS payload API

`src.aws_payload` is the backend-only Python boundary for project metadata,
recording lifecycle state, audio, transcripts, analysis, and feedback. Callers
provide authenticated owner/project/recording IDs; they never provide bucket or
table names.

## Quick example

```python
from src.aws_payload import SpeakUpPayloadStore

payloads = SpeakUpPayloadStore.from_environment()
project = payloads.create_project(
    cognito_subject,
    project_title="Demo talk",
    description="Weekly speaking practice",
)
recording, upload = payloads.reserve_upload(
    cognito_subject,
    project.project_id,
    "audio/wav",
    idempotency_key=request_id,
)
```

The browser sends `upload.required_headers` with its PUT. The backend then calls
`confirm_upload` before processing. To play audio, an authenticated route calls
`create_original_download_url`; the S3 adapter must not be exposed directly.

## Modules

- `config.py`: validated, immutable non-secret configuration.
- `models.py`: typed projects, recordings, payload references, and statuses.
- `keys.py`: the only functions allowed to construct storage and GSI keys.
- `serialization.py`: canonical UTF-8 JSON and versioned envelopes.
- `repositories.py`: owner-scoped DynamoDB access, revisions, and deletion.
- `s3_store.py`: encrypted object transfer, streaming, signing, and purge.
- `service.py`: ownership-checking facade used by HTTP and workflow adapters.
- `factory.py`: reused boto3 clients with bounded adaptive retries/timeouts.

## Storage contracts

Original audio uses:

```text
users/{user}/projects/{project}/recordings/{recording}/original.{ext}
```

Backend artifacts use:

```text
users/{user}/projects/{project}/recordings/{recording}/artifacts/
  {producer}/{producer_version}/{artifact_name}.{ext}
```

`preprocess/{version}/...` remains read-compatible for existing audio artifacts.
New JSON payloads use `transcript.v1`, `speech-analysis.v1`, `feedback.v1`,
`artifact-manifest.v1`, or `preprocess-report.v1` envelopes. Documents must be
UTF-8 top-level objects with unique keys and finite numbers. The default size
limit is 1 MiB; transcripts may use 5 MiB. Nesting is limited to 32 levels.

## Consistency and retries

Ownership and lifecycle reads are strongly consistent. Project recording lists
use the eventually consistent owner-scoped GSI, then strongly re-read each base
record before returning it. Mutations use integer revisions. Upload reservations
also carry an idempotency key and fingerprint. Immutable JSON writes use an S3
conditional PUT; a retry accepts an existing object only when its checksum and
payload type match.

## Deletion

A normal delete removes the GSI attributes and marks the row `DELETED`, hiding
it immediately while preserving a 30-day recovery window. Permanent deletion
requires the recording ID as confirmation, stages `PURGE_PENDING`, deletes every
S3 version and delete marker under the exact validated recording prefix, and
only then removes DynamoDB metadata.

`cleanup_expired_recording` gives a backend maintenance workflow an idempotent
way to purge one `AWAITING_UPLOAD` or `FAILED` record after seven days. It does
not scan the table or create an always-on scheduler; the caller supplies the
owner/recording pair from its bounded work queue.

## Security and cost

The bucket is private, TLS-only, versioned, and encrypted with SSE-S3. This is
the lower-cost choice for the current threat model because no customer-managed
KMS key policy or KMS request charges are needed. IAM remains scoped to the
stack's resources. Pre-signed URLs expire after 15 minutes by default.

The tables use on-demand capacity. Listing performs one GSI query plus strong
base-table reads, intentionally trading a small read cost for deletion and
ownership correctness. S3 access logs and CloudTrail data events are deferred
for the MVP budget; application logs must never include audio or transcript
contents.
