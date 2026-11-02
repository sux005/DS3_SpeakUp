# SpeakUp AWS infrastructure

`speakup.yaml` defines the development backend in CloudFormation:

- private, encrypted, versioned S3 storage with HTTPS-only access
- five on-demand DynamoDB tables (`projects`, `recordings`,
  `recording-hashes`, `workflow-admissions`, and
  `workflow-reconcile-cursors`) with owner-scoped list and sparse maintenance
  GSIs
- a Cognito email user pool and public SPA client
- an API Gateway HTTP API with Cognito JWT authorization
- Lambda handlers for metadata, pre-signed uploads, and audio processing
- an image-based librosa/FFmpeg Lambda that prepares diagnostic and ASR audio
- a Standard Step Functions workflow for audio prep, Transcribe, speech metrics, and Bedrock feedback
- EventBridge capture of terminal workflow failures
- CloudWatch logs with finite retention and X-Ray tracing

The existing development bucket is adopted with `import-bucket.yaml` before the
full template is applied. Stateful resources use `DeletionPolicy: Retain`; deleting
the stack does not delete recordings, users, or DynamoDB data.

## Deployment defaults

- AWS CLI profile: `speakup-dev`
- selected Region: `us-east-2`
- stack name: `speakup-dev`
- frontend origin: `http://localhost:3000`
- Bedrock model: in-Region `amazon.nova-lite-v1:0`
- CloudWatch retention: 14 days
- audio preparation limit: 10 minutes and 100 MiB per recording

The development user pool uses the no-cost Lite tier, offers TOTP MFA without
requiring it, and uses revocable seven-day refresh tokens. A production deployment
uses Cognito Essentials with refresh-token rotation, requires TOTP MFA, enables
Cognito deletion protection, and enables DynamoDB point-in-time recovery. Set the
real production frontend origin before deploying a production stack.

## API routes

`GET /health` is public. All other routes require a Cognito JWT:

- `POST /projects`
- `GET /account/limits`
- `GET /projects`
- `POST /uploads`
- `GET /projects/{projectId}/recordings`
- `GET /recordings/{recordingId}`
- `POST /recordings/{recordingId}/confirm-upload`
- `GET /recordings/{recordingId}/download`
- `POST /recordings/{recordingId}/process`
- `DELETE /recordings/{recordingId}`
- `POST /recordings/{recordingId}/restore`
- `DELETE /recordings/{recordingId}/permanent`

`POST /uploads` requires `project_id`, `content_type`, `content_length`, and
`sha256` (the Base64 SHA-256 digest of the original file). It returns a 15-minute S3 pre-signed URL
for WAV, MP3, M4A, WebM, or Ogg audio. The browser sends every returned `required_headers`
with its PUT request; S3 verifies the signed checksum.

The browser sets the signed `Content-Length` from the `File` body; do not add it
to request headers manually. For example:

```js
const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
const sha256 = btoa(String.fromCharCode(...new Uint8Array(digest)));
const upload = await api.post("/uploads", {
  project_id: projectId,
  content_type: file.type,
  content_length: file.size,
  sha256,
});
await fetch(upload.upload_url, {
  method: "PUT",
  headers: upload.required_headers,
  body: file,
});
await api.post(`/recordings/${upload.recording_id}/confirm-upload`, {});
await api.post(`/recordings/${upload.recording_id}/process`, {});
```

The process route conditionally reserves the checksum for one recording per user
and project. A second recording with identical bytes returns HTTP 409 with
`duplicate_recording_id` and does not start another workflow. Different bytes,
or the same bytes in different projects, remain independent. Upload requests
with a checksum already reserved by a processing or complete recording return
409 before uploading. Failed or deleted recordings can be replaced by a new
recording with the same bytes. Legacy recordings without a checksum remain
processable without cross-recording duplicate detection.

The client confirms the upload and then starts processing. Repeated process
requests return the existing Standard workflow execution. Download routes return 15-minute,
owner-checked S3 URLs. Normal deletion is recoverable for 30 days; permanent
deletion requires the exact recording ID as confirmation.

### Frontend input and original-download contract

The frontend should offer **Record audio** and **Upload audio file** as two
ways to create an original recording. This is a planned interface contract;
`frontend/` does not yet contain an app.

- **Record audio:** A user clicks Record, grants microphone permission, sees an
  active recording indicator and elapsed time, and can Stop or Cancel. Stop
  produces a local audio blob for playback and review. Cancel discards it and
  stops the microphone tracks. Serve the frontend over HTTPS (or localhost
  during development) because microphone capture requires a secure context.
  Nothing uploads until the user submits the recording. Enforce the 10-minute
  duration and 100 MiB upload limits in the interface as well as in the backend.
- **Upload audio file:** A user selects an existing WAV, MP3, or M4A file,
  previews it, and submits it. The original bytes are uploaded unchanged.
- **Shared submission:** Either source supplies a file/blob, its byte length,
  a content type matching its actual container, and its SHA-256 to
  `POST /uploads`. Both sources then follow the same signed S3 PUT,
  `confirm-upload`, `process`, and
  status-polling sequence above. Do not relabel a browser-generated blob as WAV
  merely to pass validation.
- **Browser recording format:** `MediaRecorder` chooses from formats the
  browser supports; it does not guarantee WAV or MP3. The backend accepts
  `audio/webm` and `audio/ogg` in addition to WAV, MP3, and M4A. Before
  enabling Record, use `MediaRecorder.isTypeSupported()` to select a supported
  format and send its approved base content type (`audio/webm`, `audio/ogg`, or
  `audio/mp4`) consistently in the reservation and signed PUT. The backend
  stores the original container, then decodes it and writes separate WAV
  artifacts for the same Transcribe/analysis workflow used by uploaded files.
  An allowed MIME label alone does not prove the bytes are decodable audio.
- **Download original:** After either source is submitted, an authenticated
  user can request `GET /recordings/{recordingId}/download`. The API reads the
  recording under the JWT owner's ID and returns a short-lived, version-pinned
  S3 GET URL for the original bytes. The frontend can use it for playback or a
  Download original action. A bare S3 key does not grant access. Do not log or
  persist the signed URL; someone holding it can use it until it expires.

Add frontend tests for both input paths, the selected browser formats, invalid or
oversized audio, denied microphone permission, cancelled recordings, original
download, and cross-owner download denial. The browser recording controls are
future work; signed upload, browser-audio MIME support, and
original-download backend routes already exist.

## Current upload and processing workflow

The HTTP API reserves an owner-scoped recording with its original file length,
content type, and SHA-256. The client uploads the unchanged bytes with the
returned signed headers, confirms the S3 object, and explicitly starts
processing. The Standard Step Functions workflow runs audio preparation,
Amazon Transcribe, speech analysis, and Bedrock feedback. The processor stores
versioned artifacts and compact recording metadata; the frontend can poll
`GET /recordings/{recordingId}` for lifecycle status and metrics. Original audio
is not overwritten during processing.

Speech analysis applies the finalized 2026-10-31 rubric. It scores speaking
rate, scored fillers per 100 spoken words, and inside-sentence pauses per
speaking minute from 0 to 4 when estimated speech lasts at least 60 seconds.
The processor derives pauses from Transcribe word gaps and reports that method
in the metrics. Scores and detailed fields are documented in
`docs/aws-payload-api.md`. Processor ZIPs include `src/scoring`; historical
analysis artifacts remain available on workflow replay.

The workflow is implemented in `speakup.yaml`, but deployment and live
processing are separate validation steps. A failed workflow is handled by the
terminal-event handler and bounded reconciler. Scheduled maintenance handles
expired abandoned and soft-deleted recordings, and permanent deletion purges
all S3 versions for one recording. Neither the documentation checks nor the
local tests perform those AWS operations.

## Lambda packages

The API and processor import the shared `src/aws_payload` package. Build the
zip artifacts before uploading deployment objects:

```powershell
python scripts/build_lambda_packages.py
```

The command writes `build/lambda/api.zip`, `processor.zip`,
`workflow_failure.zip`, and `maintenance.zip` (built from the `retention_cleanup` handler). Upload each archive as a new versioned object under an
immutable `deployments/` key in the private deployment bucket. Pass both the
matching key and its S3 object version to `ApiCodeS3Key`/`ApiCodeS3Version`,
`ProcessorCodeS3Key`/`ProcessorCodeS3Version`, and
`FailureCodeS3Key`/`FailureCodeS3Version`. CloudFormation then updates Lambda
code when the object version changes, even when the key stays the same. Pass
`MaintenanceCodeS3Key`/`MaintenanceCodeS3Version` for the scheduled cleanup
worker.
Pass `AlarmTopicArn` for operational notifications; leaving it empty keeps alarms
visible in CloudWatch without sending notifications. The audio-preparation
worker remains an image because of its native dependencies.

## Maintenance and admission migration

The new `MaintenanceDueIndex` and admissions table need a one-time backfill for
legacy recordings. Keep `EnforceWorkflowAdmissions=false` and recovery
discovery in `dual` mode until the backfill is complete. A dry run scans every
recordings-table page without writing a cursor or changing any item, so its
totals cover the full table. An `--apply` run changes one bounded page and
stores a resume cursor in the existing recovery cursor table; repeat `--apply`
until the cursor is cleared and a verification pass reports no missing active
memberships or maintenance keys. Legacy abandoned-record cleanup is anchored
to the migration start time plus the configured grace period, so old rows are
not immediately purged by the first maintenance run.

```powershell
python scripts/backfill_maintenance_index.py `
  --recordings-table speakup-dev-recordings `
  --admissions-table speakup-dev-workflow-admissions `
  --cursor-table speakup-dev-workflow-reconcile-cursors `
  --profile speakup-dev --region us-east-2

python scripts/backfill_maintenance_index.py `
  --recordings-table speakup-dev-recordings `
  --admissions-table speakup-dev-workflow-admissions `
  --cursor-table speakup-dev-workflow-reconcile-cursors `
  --profile speakup-dev --region us-east-2 --apply
```

The dry run does not advance the cursor. Inspect its full-table totals and any
conflicts before applying changes. Enable `EnforceWorkflowAdmissions=true` only
after an independent audit of legacy active rows, and switch discovery to
index-only after the sparse index contains all due rows. No migration or
deployment is run as part of the local backend checks.

## Owner-index migration

The template deliberately retains `ProjectCreatedAtIndex` while it adds
`OwnerProjectCreatedAtIndex`; deleting the old index in the same change would
make rollback and backfill verification unsafe. New writes immediately include
the owner-scoped keys. Backfill legacy rows in dry-run mode first:

```powershell
python scripts/backfill_recording_owner_index.py `
  --table speakup-dev-recordings --profile speakup-dev --region us-east-2
```

After reviewing totals and confirming the new index is ACTIVE, repeat with
`--apply`. Compare listing results before removing the old GSI in a later,
explicit CloudFormation change.

## Audio-preparation image

The native RNNoise, librosa, SciPy, libsndfile, and FFmpeg dependencies live in a
separate Lambda container image. Before deploying, confirm the selected Region in AWS
Settings > View all projects > Overview > Additional Info > Region. The development
project currently uses `us-east-2`.

Bootstrap the retained ECR repository once:

```powershell
aws cloudformation deploy --template-file infra/audio-prep-image.yaml `
  --stack-name speakup-audio-images --profile speakup-dev --region us-east-2
```

Build and push an ARM64 image with an immutable version tag:

```powershell
$repositoryUri = aws cloudformation describe-stacks `
  --stack-name speakup-audio-images --profile speakup-dev --region us-east-2 `
  --query "Stacks[0].Outputs[?OutputKey=='RepositoryUri'].OutputValue" --output text
aws ecr get-login-password --profile speakup-dev --region us-east-2 |
  docker login --username AWS --password-stdin ($repositoryUri -split '/')[0]
docker buildx build --platform linux/arm64 `
  -f infra/lambda/audio_prep/Dockerfile `
  -t "${repositoryUri}:1.1.0" --push .
```

Resolve the pushed image digest with `aws ecr describe-images`, then pass
`${repositoryUri}@sha256:<digest>` as the main stack's `AudioPrepImageUri`
parameter. The stack requires a digest-addressed image. The worker writes
versioned artifacts under each recording's
`artifacts/audio-prep/<pipeline-version>-<image-identity-hash>/` prefix and reuses
them when the original ETag and configuration fingerprint match. The digest URI
is hashed into the artifact version.
Version 1.1.0 stores the conditioned reference, model-only
candidate, conservative dry/wet blend, selected diagnostic signal, and quality report.

## Cost and privacy notes

The stack uses on-demand/serverless capacity and has no provisioned concurrency.
Charges are usage-based for S3, DynamoDB (including GSI writes and strong
base-table re-reads after list queries), API Gateway, Lambda, Step Functions,
Transcribe, Bedrock, and logs. Bedrock output is capped at 800 tokens per recording.
Step Functions logs errors without execution payloads, so transcripts are not copied
into workflow logs. Deleted S3 object versions expire after 30 days; abandoned
multipart uploads are removed after 7 days.

## Transcribe account access

At the last development-account check, the AWS project plan prevented Amazon
Transcribe calls. The workflow, Lambda permission, and S3 paths are configured
in this repository, but that account restriction was not rechecked during local
documentation work. Verify Transcribe access and rerun the live workflow smoke
test before processing recordings in a deployed environment.

## Validation

Run from the repository root:

```powershell
aws cloudformation validate-template --template-body file://infra/speakup.yaml --profile speakup-dev --region us-east-2
```

After deployment, run the opt-in API checkpoints with `SPEAKUP_LIVE_API=1`,
`SPEAKUP_E2E_API_URL`, and `SPEAKUP_E2E_JWT` set. The checkpoint test in
`tests/test_live_backend_e2e.py` creates a QA project, signs and uploads a
synthetic WAV, confirms its size and checksum, lists the recording, and downloads
the original. The separate `SPEAKUP_LIVE_E2E=1` workflow test needs
`SPEAKUP_E2E_WAV_PATH` with non-private speech and working Transcribe access.

CloudFormation service validation also runs when the stack change set is created.
Use `cfn-lint` locally. `cfn-guard` remains a recommended CI addition; until it
is installed, local security/compliance policy evaluation is not claimed.

## Cleanup

Delete the CloudFormation stack to remove stateless resources and stop future idle
logging. S3, DynamoDB, and Cognito are retained intentionally and must be reviewed
and removed separately when their data is no longer needed.
