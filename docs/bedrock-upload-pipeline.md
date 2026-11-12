# Bedrock in the upload pipeline

## Current architecture

Bedrock is already the final optional stage of the Standard Step Functions
workflow in `infra/speakup.yaml`:

1. The browser uploads original audio to the private S3 bucket.
2. The S3 event starts audio preparation automatically.
3. The workflow runs Transcribe and deterministic analytics.
4. `GenerateFeedback` calls the processor Lambda with `action=feedback`.
5. The processor reads the persisted transcript and metrics from private S3 and
   DynamoDB references, invokes Amazon Nova Lite through the Bedrock Converse
   API, writes a versioned `feedback.json` artifact to S3, adds its reference to
   the recording, and marks the recording `COMPLETE`.

The workflow is wired, but the deployment flag defaults to
`EnableBedrockFeedback=false`. With that value, `GenerateFeedback` records a
safe `SKIPPED` event and still completes the recording without a feedback
artifact.

## Token and privacy safeguards

- The processor sets `maxTokens=800`; it does not use the model maximum.
- `BEDROCK_MAX_INPUT_CHARS` defaults to 80,000 and rejects larger serialized
  inputs before invocation.
- The prompt tells the model to treat the transcript as data, not instructions,
  and to use only persisted measurements as evidence.
- Application logs must never contain transcript text, prompt text, model
  response text, credentials, audio bytes, or pre-signed URLs.
- The processor and direct smoke test report only status, latency, token counts,
  stop reason, model ID, recording ID, and response length where applicable.

## Diagnose before enabling

Authenticate with the short-lived development profile, verify the model exists
in `us-east-2`, then make one small bounded request:

```powershell
aws login --profile speakup-dev
aws bedrock list-foundation-models --profile speakup-dev --region us-east-2 `
  --by-provider amazon
python scripts/smoke_test_bedrock.py
```

Interpret common failures by their exact AWS error code:

- `AccessDeniedException`: confirm the deployed processor role allows
  `bedrock:InvokeModel` for the selected in-Region model and that the signed-in
  developer has permission to perform the smoke test.
- `ResourceNotFoundException` or `ValidationException`: recheck the model ID and
  Region. SpeakUp currently uses `amazon.nova-lite-v1:0` in `us-east-2`.
- `ThrottlingException` or daily-token wording: retain the explicit token cap,
  record `inputTokens`/`outputTokens`, wait for the quota window when necessary,
  and request a quota change only after measuring actual usage.

### Development-account finding (2026-11-12)

Live bounded requests to both `amazon.nova-lite-v1:0` and
`mistral.ministral-3-3b-instruct` failed with:

`ThrottlingException: Too many tokens per day, please wait before trying again.`

CloudWatch reported eight `InvocationThrottles` in the inspected 24-hour window
and no `InputTokenCount` or `OutputTokenCount` datapoints. This means requests
were rejected before model execution; the prompt, output cap, processor IAM role,
and Nova model availability were not the cause. The account's Bedrock Runtime
allowance or account plan must be restored before enabling feedback. Do not set
`EnableBedrockFeedback=true` while this condition remains, because the workflow
correctly treats a failed required feedback stage as a failed recording.

The account exposes positive quotas for the separate Bedrock Mantle endpoint,
but silently replacing Converse/Nova with that endpoint would change the model,
client API, IAM surface, and prompt behavior. It is not a minimal bug fix and was
not used as an automatic fallback. The AWS account owner should first recheck
Bedrock Runtime after the daily quota window and then review the account plan or
open an AWS support case if bounded calls still receive the same error.

## Enable and verify

Enabling the flag changes the deployed stack and therefore requires explicit
team approval. Preserve every existing CloudFormation parameter and change only
`EnableBedrockFeedback` to `true`; do not edit the Lambda environment by hand,
because a later stack update would overwrite it.

After deployment, upload one non-private spoken-English recording through the
normal public API path:

```powershell
python scripts/run_live_pipeline.py <recording.wav>
```

The run is successful only when all of these are true:

- Step Functions enters and exits `GenerateFeedback` successfully.
- The public recording status becomes `COMPLETE`.
- The recording has a `feedback_s3_key` reference.
- `GET /recordings/{recordingId}/artifacts/feedback` succeeds for the owner.
- The runner reports `artifact.feedback: SUCCESS`.
- CloudWatch shows a successful processor invocation without transcript or
  feedback content in logs.

The detailed runner JSONL and the bounded evidence-capture script provide the
timings and stage outcomes needed for the PR. Never commit Cognito passwords,
JWTs, signed URLs, transcript text, or private audio.

## Safe deployment and baseline validation (2026-11-12)

The privacy-safe processor logging update was deployed through an inspected
CloudFormation change set with no resource replacements. Feedback remained
disabled. The deployed processor artifact is:

`deployments/speakup-dev/processor-bedrock-observability-f27ab682212f.zip`

A real 48 kHz `SPEAKUP 2.m4a` upload then completed through the normal public
route and automatic S3 trigger:

- Project: `1fab9d84-f199-49f4-92ce-c85d0937aaae`
- Recording: `c46d23cd-94b2-5512-9339-be1b828bf0e2`
- Step Functions execution: `SUCCEEDED`
- Upload-to-terminal processing: 69.629 seconds
- Audio preprocessing: 45.278 seconds
- Transcribe start: 1.493 seconds
- Transcribe wait: 15.044 seconds
- Transcript check: 0.183 seconds
- Analytics: 0.478 seconds
- Guarded feedback stage: 0.199 seconds, `SKIPPED`
- Transcript artifact: 92 timestamped items
- Analysis: 67 words, 116.86 WPM, 4 fillers, 11 pauses
- Original download: SHA-256 matched the uploaded bytes

DynamoDB recorded status `COMPLETE` and references for the original audio, four
audio-preparation artifacts, preprocessing report, transcript, and speech
analysis. Every inspected S3 object was private, versioned, and encrypted with
SSE-S3. No feedback artifact exists because Bedrock was deliberately not enabled
while the account rejects model invocations.
