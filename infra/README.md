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
- a Standard Step Functions workflow for audio prep, Transcribe, deterministic speech metrics, and optional Bedrock feedback
- EventBridge routing for original-upload starts and terminal workflow failures
- CloudWatch logs with finite retention and X-Ray tracing

The existing development bucket is adopted with `import-bucket.yaml` before the
full template is applied. Stateful resources use `DeletionPolicy: Retain`; deleting
the stack does not delete recordings, users, or DynamoDB data.

## Deployment defaults

- AWS CLI profile on this workstation: `speakup` (other developers may use a different local profile name)
- selected Region: `us-east-2`
- stack name: `speakup-dev`
- frontend origin: `http://localhost:3000`
- Bedrock model: in-Region `amazon.nova-lite-v1:0`
- Bedrock inference API: `converse` by default; `mantle-chat` is available for
  models exposed through the signed Bedrock Mantle endpoint
- Bedrock feedback: disabled by default with `EnableBedrockFeedback=false`.
  The deployed `speakup-dev` stack currently overrides this with
  `BedrockInferenceMode=mantle-chat`, `BedrockModelId=openai.gpt-oss-20b`,
  and `EnableBedrockFeedback=true`; preserve those parameters on later updates.
- CloudWatch retention: 14 days
- audio preparation limit: 10 minutes and 100 MiB per recording

The development user pool uses the no-cost Lite tier, offers TOTP MFA without
requiring it, and uses revocable seven-day refresh tokens. A production deployment
uses Cognito Essentials with refresh-token rotation, requires TOTP MFA, enables
Cognito deletion protection, and enables DynamoDB point-in-time recovery. Set the
real production frontend origin before deploying a production stack.

### Google sign-in (optional, off by default)

Google sign-in is off until `GoogleClientId` is set. To turn it on for a development stack:

1. In Google Cloud Console, create an OAuth client of type "Web application".
2. Store the client secret in Secrets Manager as JSON with the key `client_secret`,
   for example in a secret named `speakup/dev/google-oauth`. It never goes in a parameter or the repo.
3. Deploy with `GoogleClientId=<id>.apps.googleusercontent.com` and
   `GoogleClientSecretName=speakup/dev/google-oauth`.
4. Read the `CognitoDomain` output. It is the stack name plus a short ID taken from the
   stack, for example `speakup-dev-1a2b3c4d.auth.us-east-2.amazoncognito.com`, and never
   contains the account ID.
5. Back in Google Cloud Console, add `https://<CognitoDomain>/oauth2/idpresponse` as an
   authorized redirect URI. Google sign-in fails until this matches.
6. Copy `CognitoDomain` to the frontend as `NEXT_PUBLIC_COGNITO_DOMAIN`.

Two redirect addresses are involved, and only one goes in Google Cloud:

| Address | Where it goes | Who sets it |
| --- | --- | --- |
| `https://<CognitoDomain>/oauth2/idpresponse` | Google OAuth client, "Authorized redirect URIs" | You, in step 5 |
| `<CorsAllowedOrigin>/auth/callback` (the site's own page) | Cognito app client | The stack, from `CorsAllowedOrigin` |

So when the site moves to a hosted URL, redeploy with `CorsAllowedOrigin=<that URL>`.
The Google client does not change. Only one site origin works at a time, so a stack
pointed at the hosted site no longer accepts Google sign-in from `localhost`.

This adds a Cognito hosted sign-in domain, a Google identity provider, and the
authorization code flow (with PKCE in the browser) on the existing app client. The
callback is `<CorsAllowedOrigin>/auth/callback`. Cognito creates a separate user the
first time someone signs in with Google, so a Google account and an email-password
account with the same address are two different SpeakUp users. A production stack
refuses `GoogleClientId` for now: Google users skip the TOTP MFA that production
requires, so the team needs to decide how MFA applies to them first.

Before deleting a stack that had Google sign-in on, remove its
`https://<CognitoDomain>/oauth2/idpresponse` redirect URI from the Google OAuth client
(or delete the client). Deleting the stack frees its Cognito domain name, and anyone
could then claim it. While Google still lists it, Google sends sign-ins there.

## API routes

`GET /health` is public. All other routes require a Cognito JWT:

- `POST /projects`
- `GET /account/limits`
- `GET /examples` and `GET /examples/{exampleId}`
- `GET /examples/{exampleId}/review`, `/analysis`, and `/download`
- `GET /projects`
- `POST /uploads`
- `POST /transcription-streams`
- `GET /projects/{projectId}/recordings`
- `GET /recordings/{recordingId}`
- `GET /recordings/{recordingId}/artifacts/{artifactType}`
- `GET /recordings/{recordingId}/review`
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
// The S3 Object Created event confirms and starts processing automatically.
await pollRecordingUntilTerminal(upload.recording_id);
```

The process route conditionally reserves the checksum for one recording per user
and project. A second recording with identical bytes returns HTTP 409 with
`duplicate_recording_id` and does not start another workflow. Different bytes,
or the same bytes in different projects, remain independent. Upload requests
with a checksum already reserved by a processing or complete recording return
409 before uploading. Failed or deleted recordings can be replaced by a new
recording with the same bytes. Legacy recordings without a checksum remain
processable without cross-recording duplicate detection.

S3 sends the original-object event through EventBridge to a dedicated trigger
Lambda. The trigger verifies the reserved object's checksum and length, applies
duplicate and workflow-admission guards, and starts one deterministic Standard
workflow execution. Duplicate object events and repeated process requests return
the existing execution. The confirm and process routes remain idempotent recovery
endpoints but are not required in the normal client flow. Download routes return 15-minute,
owner-checked S3 URLs. Normal deletion is recoverable for 30 days; permanent
deletion requires the exact recording ID as confirmation.

### Frontend input and original-download contract

The frontend offers **Record audio** and **Upload audio file** as two
ways to create an original recording. The local development frontend can use
the server-only guest bridge with `SPEAKUP_DEV_GUEST_MODE=1`; deployed API routes
remain JWT-protected and should not be made public.

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
  `POST /uploads`. Both sources then follow the same signed S3 PUT and
  status-polling sequence; the object event starts processing automatically.
  Do not relabel a browser-generated blob as WAV
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

Frontend tests cover both input paths, selected browser formats, invalid or
oversized audio, denied microphone permission, cancelled recordings, and the
signed upload and review flow. Backend tests cover owner-scoped download; the
live browser QA suite mocks AWS and the development guest bridge is intended for
local verification only.

## Live transcription rollout

The stack exposes the session route only when `Environment=dev`. Deploy the
API ZIP and template together so the JWT-protected session route and
Transcribe permission reach AWS with the handler. The web build can then enable
`NEXT_PUBLIC_SPEAKUP_AWS_STREAMING=1` along with the API and Cognito settings.
The session URL expires after 60 seconds and must never be logged or persisted.
Verify one authenticated stream and pause/resume on the hosted HTTPS origin
before the rehearsal. When streaming is unavailable, users can still record
and submit for batch analysis. Rebuild with the setting unset to disable AWS
streaming in the recorder.

## Current upload and processing workflow

The HTTP API reserves an owner-scoped recording with its original file length,
content type, and SHA-256. The client uploads the unchanged bytes with the
returned signed headers. S3 publishes the completed object event through
EventBridge, which idempotently starts the Standard Step Functions workflow;
the normal client does not call confirm or process routes. The workflow runs
audio preparation, Amazon Transcribe, and deterministic speech analysis.
Bedrock coaching runs only when `EnableBedrockFeedback=true`; otherwise the
recording completes after analytics. `BedrockInferenceMode` selects either the
Bedrock Runtime Converse API or the signed Bedrock Mantle Chat Completions API;
both produce the same private feedback artifact. The processor stores versioned
artifacts and compact recording metadata; the frontend can poll
`GET /recordings/{recordingId}` for lifecycle status and metrics. Original audio
is not overwritten during processing. When processing completes, clients can
fetch timed transcript words and summary metrics from
`GET /recordings/{recordingId}/review`; category and moment feedback is present
when Bedrock coaching runs.

Speech analysis applies the finalized 2026-10-31 rubric. It scores speaking
rate, scored fillers per 100 spoken words, and inside-sentence pauses per
speaking minute from 0 to 4 when estimated speech lasts at least 60 seconds.
The processor uses valid acoustic pause inputs from audio preparation when
available, otherwise it falls back to Transcribe word gaps. The metrics report
which method ran. Scores and detailed fields are documented in
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
  --profile speakup --region us-east-2

python scripts/backfill_maintenance_index.py `
  --recordings-table speakup-dev-recordings `
  --admissions-table speakup-dev-workflow-admissions `
  --cursor-table speakup-dev-workflow-reconcile-cursors `
  --profile speakup --region us-east-2 --apply
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
  --table speakup-dev-recordings --profile speakup --region us-east-2
```

After reviewing totals and confirming the new index is ACTIVE, repeat with
`--apply`. Compare listing results before removing the old GSI in a later,
explicit CloudFormation change.

## Audio-preparation image

The DeepFilterNet3 model, CPU PyTorch runtime, librosa, SciPy, libsndfile, and
FFmpeg dependencies live in a separate Python 3.11 Lambda container image. The
legacy RNNoise backend remains available for local compatibility but is not bundled
in the production image. Before deploying, confirm the selected Region in AWS Settings > View all
projects > Overview > Additional Info > Region. The development project currently
uses `us-east-2`.

Bootstrap the retained ECR repository once:

```powershell
aws cloudformation deploy --template-file infra/audio-prep-image.yaml `
  --stack-name speakup-audio-images --profile speakup --region us-east-2
```

Build and push an x86-64 image with an immutable version tag. The image build downloads
the DeepFilterNet3 checkpoint from the matching `v0.5.6` source tag, verifies its pinned
SHA-256, and embeds it in the immutable image, so runtime processing does not download
model weights:

```powershell
$repositoryUri = aws cloudformation describe-stacks `
  --stack-name speakup-audio-images --profile speakup --region us-east-2 `
  --query "Stacks[0].Outputs[?OutputKey=='RepositoryUri'].OutputValue" --output text
aws ecr get-login-password --profile speakup --region us-east-2 |
  docker login --username AWS --password-stdin ($repositoryUri -split '/')[0]
docker buildx build --platform linux/amd64 --provenance=false `
  -f infra/lambda/audio_prep/Dockerfile `
  -t "${repositoryUri}:2.0.0" --push .
```

Resolve the pushed image digest with `aws ecr describe-images`, then pass
`${repositoryUri}@sha256:<digest>` as the main stack's `AudioPrepImageUri`
parameter. The stack requires a digest-addressed image. The worker writes
versioned artifacts under each recording's
`artifacts/audio-prep/<pipeline-version>-<image-identity-hash>/` prefix and reuses
them when the original ETag and configuration fingerprint match. The digest URI
is hashed into the artifact version.
Version 2.0.0 stores the 48 kHz normalized reference, DeepFilterNet model candidate,
conservative dry/model blend, selected diagnostic signal, and quality report. The model
candidate is preferred when it passes the distortion gate; the blend and reference are
fallbacks. The audio worker uses the account-supported 3,008 MB memory maximum and a
10-minute Lambda timeout so the configured 10-minute recording limit has CPU and memory
headroom; the Step Functions task timeout is 10.5 minutes.

## Cost and privacy notes

The stack uses on-demand/serverless capacity and has no provisioned concurrency.
Charges are usage-based for S3, DynamoDB (including GSI writes and strong
base-table re-reads after list queries), API Gateway, Lambda, Step Functions,
Transcribe, optional Bedrock, and logs. When enabled, Bedrock output is capped
at 1200 tokens per recording for structured review feedback.
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

The template currently exceeds CloudFormation's 51,200-byte inline
`TemplateBody` limit. Running `validate-template` with `--template-body`
and `file://infra/speakup.yaml` therefore fails before validating the template.
Validate a staged copy through `--template-url`, or validate through a
CloudFormation change set. Use `cfn-lint` locally when installed.

After deployment, run the opt-in API checkpoints with `SPEAKUP_LIVE_API=1`,
`SPEAKUP_E2E_API_URL`, and `SPEAKUP_E2E_JWT` set. The checkpoint test in
`tests/test_live_backend_e2e.py` creates a QA project, signs and uploads a
synthetic WAV, confirms its size and checksum, lists the recording, and downloads
the original. The separate `SPEAKUP_LIVE_E2E=1` workflow test needs
`SPEAKUP_E2E_WAV_PATH` with non-private speech and working Transcribe access.

CloudFormation service validation also runs when the stack change set is created.
`cfn-guard` remains a recommended CI addition; until it is installed, local
security/compliance policy evaluation is not claimed.

### Development security check (2026-11-20)

Read-only AWS checks used account `110359221190`, Region `us-east-2`, and local
profile `speakup`. The `speakup-dev` stack was `UPDATE_COMPLETE`. The deployed
bucket had all four public-access blocks enabled, reported `IsPublic=false`,
used bucket-owner-enforced ownership, AES256 default encryption, and versioning,
and denied insecure transport through its bucket policy. CORS allowed the
development origin `http://localhost:3000`. Lifecycle aborted incomplete
multipart uploads after 7 days and expired noncurrent object versions after 30
days; it does not expire current versions.

All six stack Lambda functions were active and used their expected IAM roles.
Each role had its expected inline policy and no attached managed policies. S3
object permissions in those policies were limited to this bucket's `users/*`
prefix; the processor and audio-prep roles also had bucket-list permission.
Lambda environment variable names did not include access-key or secret-key
fields. `GET /health` returned 200 and an unsigned `GET /projects` returned 401.
The targeted S3, API, and retention suite passed all 35 tests, including the
Moto test for permanent version purge.

IAM simulation reported an Organizations explicit deny for API-role S3 and
DynamoDB actions that its inline policy allows. This identity was denied access
to inspect the organization's policies, so the effective runtime permission
remains unverified. A production stack named `speakup-prod` was not present in
this account and Region. Authenticated tests with two Cognito test users are
still needed for cross-owner reads, signed upload/download boundaries, URL
expiry, and live deletion and version purge.

### Security check follow-up (2026-11-26 to 2026-11-27)

Local Python compilation passed with `python -m compileall -q infra src/aws_payload`
on November 26. On November 27, the project virtual environment passed
`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest -q
tests/test_api_checkpoints.py` (2 tests). The system Python lacks pytest, but
the project virtual environment has it. Neither `cfn-lint` nor `cfn-guard` was
installed, so template linting and security-policy evaluation were not run.
No AWS result was refreshed: `aws sts get-caller-identity --profile speakup
--region us-east-2` returned `Your session has expired. Please reauthenticate
using 'aws login'`, before the read-only CloudFormation, S3, IAM, API Gateway,
and CloudWatch inspections could start.
The 2026-11-20 deployed findings above therefore remain the latest deployed
evidence; they were not revalidated by this follow-up.

### Remaining security checks

- Re-authenticate the `speakup` AWS profile, then repeat the read-only checks for
  the `speakup-dev` stack in `us-east-2`.
- Resolve the deployed `DataBucketName`, Lambda execution roles, HTTP API ID,
  and log groups from CloudFormation before querying S3 public-access,
  encryption, versioning, lifecycle, IAM policy attachment, API authorizer, and
  CloudWatch retention settings.
- Resolve the Organizations explicit deny affecting the API role's S3 and
  DynamoDB permissions, or document the effective runtime behavior with a
  successful authenticated checkpoint.
- Run authenticated two-user checks for cross-owner reads, signed upload and
  download boundaries, URL expiry, deletion, and permanent version purge.
- Verify Transcribe account access and run the deployed workflow smoke test only
  with non-private audio after the account restriction is cleared.
- Add production-specific evidence after a `speakup-prod` deployment exists;
  current findings are development-account evidence only.

## Cleanup

Delete the CloudFormation stack to remove stateless resources and stop future idle
logging. S3, DynamoDB, and Cognito are retained intentionally and must be reviewed
and removed separately when their data is no longer needed.
