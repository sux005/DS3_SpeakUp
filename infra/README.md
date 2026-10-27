# SpeakUp AWS infrastructure

`speakup.yaml` defines the development backend in CloudFormation:

- private, encrypted, versioned S3 storage with HTTPS-only access
- two on-demand DynamoDB tables (`projects` and `recordings`) with an
  owner-scoped recording-list GSI
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

`POST /uploads` returns a 15-minute S3 pre-signed URL for WAV, MP3, or M4A audio.
The client uploads directly to S3 with every returned required header, confirms
the upload, and then starts processing. Download routes return 15-minute,
owner-checked S3 URLs. Normal deletion is recoverable for 30 days; permanent
deletion requires the exact recording ID as confirmation.

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
