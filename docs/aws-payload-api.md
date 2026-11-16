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
| `GET /account/limits` | Returns the owner's active workflow count and current upload limits. |
| `POST /projects` | Creates owner-scoped metadata. |
| `GET /projects` | Lists projects with an opaque cursor. |
| `POST /uploads` | Reserves a recording and returns a conditional pre-signed PUT. |
| `GET /projects/{projectId}/recordings` | Lists newest recordings via the owner GSI. |
| `GET /recordings/{recordingId}` | Strongly reads visible metadata. |
| `GET /recordings/{recordingId}/artifacts/{artifactType}` | Owner-checks and returns public `transcript`, `analysis`, or `feedback` data from S3. |
| `POST /recordings/{recordingId}/confirm-upload` | Idempotent recovery endpoint that verifies S3 and marks the upload ready. |
| `GET /recordings/{recordingId}/review` | Returns the completed recording's normalized timed transcript and structured feedback. |
| `GET /recordings/{recordingId}/download` | Returns a short-lived owner-checked GET URL. |
| `POST /recordings/{recordingId}/process` | Idempotent recovery endpoint that starts or rejoins the Standard workflow. |
| `DELETE /recordings/{recordingId}` | Soft-deletes with a 30-day recovery window. |
| `POST /recordings/{recordingId}/restore` | Restores a recoverable recording. |
| `DELETE /recordings/{recordingId}/permanent` | Purges all object versions after exact-ID confirmation. |

`POST /uploads` requires `project_id`, `content_type`, Base64 `sha256`, and
positive `content_length` within the configured upload limit. The returned
PUT signature binds the byte length; browsers send `Content-Length` from the
file body automatically, so it is omitted from `required_headers`.
Confirmation checks the stored length again. The server derives `recording_id`
from the authenticated user, project, and `idempotency_key`; clients should
not send `recording_id`. A reservation retry with the same idempotency key and
identical fields returns the existing recording. Reusing that key with a
different recording ID or other input is rejected, so the frontend can safely
retry a request without creating a second upload reservation.

After the signed PUT succeeds, S3 sends an `Object Created` event through
EventBridge. A dedicated least-privilege Lambda validates that the key belongs
to the reservation, confirms the checksum and length, applies duplicate and
admission controls, and starts the deterministic Step Functions execution.
The normal client does not call `confirm-upload` or `process`; those routes are
retained for operational recovery and backward compatibility. Duplicate event
delivery is safe because recording revisions, checksum claims, and the stable
execution name make the start idempotent.

`GET /account/limits` returns `active_workflows`, `max_active_workflows`,
`remaining_workflows`, `admission_enforced`, `max_audio_upload_bytes`,
`max_audio_duration_seconds`, `abandoned_retention_days`, and
`deleted_recovery_days`. The frontend can use these values to explain upload
and processing limits. The server remains authoritative: a processing request
that exceeds the active workflow limit returns HTTP 429 with
`code: "ACTIVE_WORKFLOW_LIMIT"`, `retryable: true`, and `Retry-After: 60`.

Recording responses expose `user_id`, `project_id`, `recording_id`, timestamps,
`status`, `content_type`, and `revision`, plus `content_length`,
`summary_metrics`, and `audio_prep_status` when available. A failed recording
returns a generic `failure_reason`. S3 keys, artifact references, execution
ARNs, Transcribe job names, and internal failure details are not part of the
HTTP recording response. `POST /uploads` still returns the reserved object key
and signed upload URL needed for that upload.

Completed-review screens use
`GET /recordings/{recordingId}/artifacts/{artifactType}`, where `artifactType`
is `transcript`, `analysis`, or `feedback`. The API strongly reads the
authenticated owner's recording before reading S3 and returns
`recording_id`, `artifact_type`, and `data`. It does not expose S3 references,
producer metadata, or the Bedrock model ID.

`GET /recordings/{recordingId}/review` returns HTTP 409 until processing is
`COMPLETE`. Its `transcript` object contains `text` and timed Transcribe `items`.
The response also includes `summary_metrics`. When Bedrock coaching is disabled
or feedback is unavailable, `feedback` is `null`; the transcript and metrics
remain available for review.
Its `feedback` object contains the existing `feedback` summary string, plus
`schema_version: 2`, `categories`, `moments`, and `metrics` for new
recordings. The four categories are `general`, `pace`, `fillers`, and `pauses`;
each has an `observation` and a concrete `next_step`. A moment has an `id`,
`start_seconds`, `end_seconds`, `text`, `kind` (`strength` or `improve`),
`observation`, and `next_step`. Moment times are derived from the transcript's
word timings, not generated by the model. They share the original recording's
timeline because audio preparation preserves it. A client can render timed
words in sync with playback, highlight the intervals covered by moments, and
show the corresponding action on selection. Moment kinds are evidence based;
very short or one-sided speech may have only strengths or only improvements.
Feedback created before schema 2
has only the summary string and model ID; clients should allow that shape.

Mutation bodies may include `expected_revision`. Omitting it makes the adapter
use the current strong read; backend-to-backend callers should provide it when
they already hold a record. Permanent deletion also requires
`{"confirmation":"<recordingId>"}`.

## Error model

The internal package exposes stable domain exceptions rooted at `PayloadError`.
The HTTP adapter maps validation to 400, missing/cross-owner data to 404,
idempotency/revision/state/integrity conflicts to 409, and unexpected AWS
`ClientError` failures to 503. Active workflow admission failures map to 429.
AWS error text is not returned to clients.

## JSON payload example

```json
{
  "schema_version": 1,
  "payload_type": "speech-analysis.v1",
  "producer": "speakup-speech-analysis",
  "producer_version": "4.0.0",
  "created_at": "2026-10-27T12:00:00.000Z",
  "data": {
    "metrics": {
      "rubric_version": "2026-10-31",
      "rubric_status": "scored",
      "pause_detection_method": "transcribe_word_gaps",
      "word_count": 132,
      "duration_seconds": 66.0,
      "speaking_duration_seconds": 63.0,
      "words_per_minute": 120.0,
      "filler_words": {"um": 2},
      "filler_occurrences": [
        {"filler": "um", "start_seconds": 0.0, "end_seconds": 0.28}
      ],
      "fillers_per_100_words": 1.52,
      "pauses_inside_sentences": 8,
      "pauses_per_speaking_minute": 7.62,
      "total_pause_seconds": 3.0,
      "pauses": [
        {"start_seconds": 31.2, "end_seconds": 32.3, "duration_seconds": 1.1, "inside_sentence": true}
      ],
      "long_pauses": [
        {"start_seconds": 31.2, "end_seconds": 32.3, "duration_seconds": 1.1, "inside_sentence": true}
      ],
      "rubric_scores": {
        "speaking_rate": 3,
        "filler_words": 4,
        "pauses_inside_sentences": 4
      }
    }
  }
}
```

Raw Transcribe output is stored in a backend-generated artifact key. The worker
normalizes it into `transcript.v1`; analysis and feedback are separate versioned
payloads. DynamoDB keeps compact references and summary metrics, not full
transcripts, generated feedback, or occurrence-level filler/pause arrays.
Feedback is optional: when `EnableBedrockFeedback=false`, the recording reaches
`COMPLETE` after transcript normalization, analytics, and rubric scoring without
creating a feedback artifact.

The finalized 2026-10-31 rubric scores speaking rate, scored fillers, and
inside-sentence pauses from 0 to 4. `word_count` excludes scored filler tokens;
`duration_seconds` spans the first to last word, while
`speaking_duration_seconds` removes detected pauses of at least 0.3 seconds.
Scores are `null` and `rubric_status` is `insufficient_speech` below 60 seconds
of estimated speaking time. The compact recording response also reports
unscored watch words, between-sentence pauses, and total pause time. The S3
analysis artifact adds every scored filler occurrence and detected pause with
timestamps, including the long-pause subset. Pause detection uses acoustic
energy silences within word gaps, optionally combined with Silero non-speech;
missing acoustic inputs fall back to Transcribe word gaps. The
`pause_detection_method` field names the method used. Older recordings retain their
original versioned analysis on replay.

When Bedrock feedback is enabled, its prompt includes the persisted summary
metrics and the matching rubric CSV score bands. General feedback is qualitative.
Pace uses WPM, fillers use scored fillers per 100 spoken words, and pauses use
inside-sentence pauses per speaking minute. The persisted 0–4 scores are
authoritative; watch words, between-sentence pauses, and total pause time are
diagnostic only. The prompt does not ask for long-pause details because those
occurrences are kept in the analysis artifact rather than the summary metrics.

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
