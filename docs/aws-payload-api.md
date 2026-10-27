# AWS payload API operations

## Internal Python surface

The supported entry point is `SpeakUpPayloadStore`. Its main operations are:

- `create_project`, `get_project`, and `list_projects`
- `reserve_upload` and `confirm_upload`
- `get_recording` and `list_recordings`
- `transition_recording`
- `put_json_artifact`, `get_json_artifact`, `open_payload`, and
  `download_payload`
- `create_original_download_url`
- `soft_delete`, `recover`, and `permanently_delete`
- `cleanup_expired_recording` for bounded backend maintenance work

The service accepts the authenticated Cognito `sub` as `user_id`. No caller may
select an AWS project, Region, bucket, table, index, or raw object path.

## HTTP routes

`GET /health` is public. Every other route requires the Cognito JWT authorizer.

| Route | Result |
| --- | --- |
| `POST /projects` | Creates owner-scoped metadata. |
| `GET /projects` | Lists projects with an opaque cursor. |
| `POST /uploads` | Reserves a recording and returns a conditional pre-signed PUT. |
| `GET /projects/{projectId}/recordings` | Lists newest recordings via the owner GSI. |
| `GET /recordings/{recordingId}` | Strongly reads visible metadata. |
| `POST /recordings/{recordingId}/confirm-upload` | Verifies S3 and marks the upload ready. |
| `GET /recordings/{recordingId}/download` | Returns a short-lived owner-checked GET URL. |
| `POST /recordings/{recordingId}/process` | Starts the Standard Step Functions workflow. |
| `DELETE /recordings/{recordingId}` | Soft-deletes with a 30-day recovery window. |
| `POST /recordings/{recordingId}/restore` | Restores a recoverable recording. |
| `DELETE /recordings/{recordingId}/permanent` | Purges all object versions after exact-ID confirmation. |

Mutation bodies may include `expected_revision`. Omitting it makes the adapter
use the current strong read; backend-to-backend callers should provide it when
they already hold a record. Permanent deletion also requires
`{"confirmation":"<recordingId>"}`.

## Error model

The internal package exposes stable domain exceptions rooted at `PayloadError`.
The HTTP adapter maps validation to 400, missing/cross-owner data to 404,
idempotency/revision/state/integrity conflicts to 409, and unexpected AWS
`ClientError` failures to 503. AWS error text is not returned to clients.

## JSON payload example

```json
{
  "schema_version": 1,
  "payload_type": "speech-analysis.v1",
  "producer": "speakup-speech-analysis",
  "producer_version": "1.0.0",
  "created_at": "2026-10-27T12:00:00.000Z",
  "data": {
    "metrics": {
      "words_per_minute": 132.4,
      "filler_words": {"um": 2}
    }
  }
}
```

Raw Transcribe output is stored in a backend-generated artifact key. The worker
normalizes it into `transcript.v1`; analysis and feedback are separate versioned
payloads. DynamoDB keeps compact references and summary metrics, not full
transcripts or generated feedback.

## GSI migration

The first deployment adds `OwnerProjectCreatedAtIndex` while retaining the old
`ProjectCreatedAtIndex`. New writes populate both new key attributes. Run the
backfill in dry-run mode, review invalid/conflict totals, apply it, compare list
results, then remove the old index in a later explicit deployment. Do not add
and remove GSIs in the same production change.

```powershell
python scripts/backfill_recording_owner_index.py `
  --table speakup-dev-recordings --profile speakup-dev --region us-east-2

python scripts/backfill_recording_owner_index.py `
  --table speakup-dev-recordings --profile speakup-dev --region us-east-2 --apply
```

The script scans because legacy rows lack the new partition key. It is the only
migration step that should scan this table; normal application paths never do.

## Validation and real AWS tests

Unit and botocore Stubber tests require no credentials. Any future live test
must be explicitly enabled, use isolated resources in `us-east-2`, and clean up
only those resources after the user chooses whether to keep them. The current
build does not deploy or run the backfill automatically.
