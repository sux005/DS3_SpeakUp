# SpeakUp AWS infrastructure

`speakup.yaml` defines the development backend in CloudFormation:

- private, encrypted, versioned S3 storage with HTTPS-only access
- three on-demand DynamoDB tables (`projects`, `recordings`, and
  `recording-hashes`) with an owner-scoped recording-list GSI
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

`POST /uploads` requires `project_id`, `content_type`, and `sha256` (the Base64
SHA-256 digest of the original file). It returns a 15-minute S3 pre-signed URL
for WAV, MP3, or M4A audio. The browser sends every returned `required_headers`
with its PUT request; S3 verifies the signed checksum. For example:

```js
const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
const sha256 = btoa(String.fromCharCode(...new Uint8Array(digest)));
const upload = await api.post("/uploads", {
  project_id: projectId,
  content_type: file.type,
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

The process route atomically reserves the checksum for one recording per user
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
- **Shared submission:** Either source supplies a file/blob, a content type
  matching its actual container, and its SHA-256 to `POST /uploads`. Extend the
  reservation to accept expected byte length as described below. Both sources
  then follow the same signed S3 PUT, `confirm-upload`, `process`, and
  status-polling sequence above. Do not relabel a browser-generated blob as WAV
  merely to pass validation.
- **Browser recording format gap:** `MediaRecorder` chooses from formats the
  browser supports; it does not guarantee WAV or MP3. The current backend
  accepts `audio/wav`, `audio/x-wav`, `audio/mpeg`, `audio/mp4`, and
  `audio/x-m4a`, but rejects common browser recording types such as WebM or
  Ogg. Before enabling Record, use `MediaRecorder.isTypeSupported()` to select
  a format, normalize any codec parameters to an approved upload content type,
  and extend the backend allowlist, key extension rules, decoder tests, and
  upload confirmation for the chosen browser formats. Preserve that
  browser-generated file as the original; preprocessing produces separate WAV
  artifacts. Do not assume a container is safe or decodable from its MIME
  label alone.
- **Download original:** After either source is submitted, an authenticated
  user can request `GET /recordings/{recordingId}/download`. The API reads the
  recording under the JWT owner's ID and returns a short-lived, version-pinned
  S3 GET URL for the original bytes. The frontend can use it for playback or a
  Download original action. A bare S3 key does not grant access. Do not log or
  persist the signed URL; someone holding it can use it until it expires.

Add tests for both input paths, the selected browser formats, invalid or
oversized audio, denied microphone permission, cancelled recordings, original
download, and cross-owner download denial. The browser recording controls and
MIME support are future work; the signed upload and original-download backend
routes already exist.

## Proposed upload-to-audio-preparation workflow

**Target design; not the current deployed workflow.** The current
`speakup.yaml` state machine continues from audio preparation into Amazon
Transcribe, speech metrics, and Bedrock feedback. The team has not selected an
STT model, so the first delivery milestone should end when prepared audio and
its quality report are durably stored. No frontend implementation is included
in this design.

```text
Record button or file picker ──> one file/blob ──> frontend
Frontend ──reserve upload──> API Gateway / API Lambda
Frontend ──signed PUT──────> private S3 original
Frontend ──confirm + process──> API Lambda ──> Step Functions
Step Functions ──> audio-preparation Lambda ──> versioned S3 artifacts
Step Functions ──> finalization Lambda ──> DynamoDB AUDIO_PREPARED
Frontend ──GET recording──> API Lambda ──> status and artifact metadata
Frontend ──GET download──> API Lambda ──signed GET──> original in S3
```

1. **Reserve and upload.** An authenticated client sends the project ID,
   content type, and Base64 SHA-256 of the file to `POST /uploads`. The API uses
   the Cognito `sub` as owner, creates an `AWAITING_UPLOAD` recording, and returns
   a short-lived pre-signed PUT for one server-generated key. The client sends
   every returned `required_headers` value with the file. It never chooses a
   bucket or key and never receives AWS credentials. Keep the bucket private,
   encrypted, versioned, TLS-only, and CORS-scoped to the frontend origin.
2. **Confirm the object.** After S3 accepts the PUT, the client calls
   `confirm-upload`. The API checks that the original exists at the reserved
   key and matches its content type and checksum before changing the recording
   to `UPLOADED`. Add the expected byte length to the reservation and verify it
   here as well. A matching checksum does not establish that the file is valid
   audio; the preparation worker checks decoding, duration, and channel limits.
3. **Start one workflow.** The client calls `POST /recordings/{id}/process`. The
   API atomically reserves the source checksum, changes `UPLOADED` to
   `PROCESSING`, and starts one Standard Step Functions execution with the
   recording ID as its stable name. Its input contains owner, project,
   recording, and original S3 key only. Repeated requests return the existing
   recording/execution. Keep this explicit handshake as the authoritative
   trigger; an S3 notification alone cannot establish owner or lifecycle state
   and may be delivered more than once.
4. **Prepare and persist.** The image-based audio-preparation Lambda reads the
   original, enforces size and duration limits, and runs `src/audio`. It writes
   versioned reference, enhanced, and selected diagnostic WAV files plus the
   report to server-derived S3 keys. The original is never overwritten. It
   then attaches verified artifact references to the recording. On replay, it
   checks that *all* expected objects exist and repairs missing metadata before
   returning a reused result; a report alone is insufficient proof of success.
5. **Finalize.** A small processor action verifies the report and artifact
   references, then conditionally changes `PROCESSING` to `AUDIO_PREPARED`.
   Repeating finalization returns the saved result. `AUDIO_PREPARED` means the
   upload-to-preparation milestone succeeded; it does not imply transcription,
   speech metrics, or feedback. `GET /recordings/{id}` exposes this status and
   compact artifact metadata for client polling.

The active workflow should become `PreprocessAudio -> FinalizePreparation ->
Succeed`, with bounded retries and task timeouts. Each failure path records a
terminal `FAILED` state and a safe, short reason. Retry `MarkFailed` itself and
use the EventBridge terminal-failure handler to reconcile a recording left in
`PROCESSING` if that write fails. Do not log audio bytes, signed URLs, or report
contents. A later STT workflow can start from `AUDIO_PREPARED` and record its
provider, model/version, selected input artifact, and transcript artifact
without changing the upload or preparation contract.

Before rollout, test duplicate upload/process requests; checksum, size, and
invalid-audio failures; interruption after each S3 artifact write; metadata
reconciliation on replay; duplicate finalization; and failure while marking a
recording failed. Validate the state machine and exercise a development upload
through `AUDIO_PREPARED`. This design requires changes to `speakup.yaml`, the
recording lifecycle, the audio-preparation reuse path, processor finalization,
failure recovery, and workflow contract tests. It does not select or run STT.

## Lambda packages

The API and processor import the shared `src/aws_payload` package. Build the
zip artifacts before uploading deployment objects:

```powershell
python scripts/build_lambda_packages.py
```

The command writes `build/lambda/api.zip`, `processor.zip`, and
`workflow_failure.zip`. Upload them under immutable `deployments/` keys in the
private deployment bucket and pass those keys to the matching template
parameters. The audio-preparation worker remains an image because of its native
dependencies.

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

Pass the resulting full image URI as the main stack's `AudioPrepImageUri`
parameter. The worker writes versioned artifacts under each recording's
`preprocess/1.1.0/` prefix and reuses them when the original ETag and configuration
fingerprint match. Version 1.1.0 stores the conditioned reference, model-only
candidate, conservative dry/wet blend, selected diagnostic signal, and quality report.

## Cost and privacy notes

The stack uses on-demand/serverless capacity and has no provisioned concurrency.
Charges are usage-based for S3, DynamoDB (including GSI writes and strong
base-table re-reads after list queries), API Gateway, Lambda, Step Functions,
Transcribe, Bedrock, and logs. Bedrock output is capped at 800 tokens per recording.
Step Functions logs errors without execution payloads, so transcripts are not copied
into workflow logs. Deleted S3 object versions expire after 30 days; abandoned
multipart uploads are removed after 7 days.

## Current plan limitation

The AWS project is currently on the Free plan. Amazon Transcribe is available
only on the Paid plan in the new AWS experience, so the managed project policy
currently denies Transcribe API calls. The workflow, Lambda permission, and S3
paths are already configured; after the project owner upgrades in AWS Settings,
rerun the Transcribe smoke test before processing recordings.

## Validation

Run from the repository root:

```powershell
aws cloudformation validate-template --template-body file://infra/speakup.yaml --profile speakup-dev --region us-east-2
```

CloudFormation service validation also runs when the stack change set is created.
Use `cfn-lint` locally. `cfn-guard` remains a recommended CI addition; until it
is installed, local security/compliance policy evaluation is not claimed.

## Cleanup

Delete the CloudFormation stack to remove stateless resources and stop future idle
logging. S3, DynamoDB, and Cognito are retained intentionally and must be reviewed
and removed separately when their data is no longer needed.
