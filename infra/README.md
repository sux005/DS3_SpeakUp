# SpeakUp AWS infrastructure

`speakup.yaml` defines the development backend in CloudFormation:

- private, encrypted, versioned S3 storage with HTTPS-only access
- two on-demand DynamoDB tables (`projects` and `recordings`)
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
- `GET /recordings/{recordingId}`
- `POST /recordings/{recordingId}/process`

`POST /uploads` accepts `project_id`, `content_type`, and `sha256` (the Base64
encoding of the file's 32-byte SHA-256 digest). It returns a 15-minute S3
pre-signed URL for WAV, MP3, or M4A audio. The browser must send the returned
`upload_headers` with its PUT request. S3 validates the checksum before storing
the file. For example:

```js
const bytes = await file.arrayBuffer();
const digest = await crypto.subtle.digest("SHA-256", bytes);
const sha256 = btoa(String.fromCharCode(...new Uint8Array(digest)));
const upload = await api.post("/uploads", {
  project_id: projectId,
  content_type: file.type,
  sha256,
});
await fetch(upload.upload_url, {
  method: "PUT",
  headers: upload.upload_headers,
  body: file,
});
await api.post(`/recordings/${upload.recording_id}/process`, {});
```

If a previously verified upload with that checksum is already processing or
complete in the project, `POST /uploads` returns HTTP 409 before uploading.
The process route verifies S3's stored checksum and atomically reserves the
`user_id` + `project_id` + SHA-256 combination. A second recording with exactly
the same bytes in that project returns HTTP 409 with `duplicate_recording_id`
and does not start another workflow. Different bytes, or the same bytes in a
different project, remain independent. A failed recording releases its checksum
claim when a new recording with the same bytes is submitted for processing.
Recordings created before this checksum contract remain processable without
cross-recording duplicate detection.

The client uploads directly to S3 and then starts processing with the final route.
Repeated process requests return the same execution instead of starting another one.
If a start attempt fails, another request can retry that same execution. Completed
and failed recordings return their current status; this route does not reprocess them.

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
Charges are usage-based for S3, DynamoDB, API Gateway, Lambda, Step Functions,
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
Use `cfn-lint` and `cfn-guard` in CI once those tools are added to the project.

## Cleanup

Delete the CloudFormation stack to remove stateless resources and stop future idle
logging. S3, DynamoDB, and Cognito are retained intentionally and must be reviewed
and removed separately when their data is no longer needed.
