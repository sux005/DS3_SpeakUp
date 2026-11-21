# Bedrock in the upload pipeline

## Current architecture

Bedrock is already the final optional stage of the Standard Step Functions
workflow in `infra/speakup.yaml`:

1. The browser uploads original audio to the private S3 bucket.
2. The S3 event starts audio preparation automatically.
3. The workflow runs Transcribe and deterministic analytics.
4. `GenerateFeedback` calls the processor Lambda with `action=feedback`.
5. The processor reads the persisted transcript and metrics from private S3 and
   DynamoDB references, invokes the configured model through Bedrock Runtime
   Converse or the signed Bedrock Mantle Chat Completions endpoint, writes a
   versioned `feedback.json` artifact to S3, adds its reference to the recording,
   and marks the recording `COMPLETE`.

The workflow is wired, but the deployment flag defaults to
`EnableBedrockFeedback=false`. With that value, `GenerateFeedback` records a
safe `SKIPPED` event and still completes the recording without a feedback
artifact.

## Token and privacy safeguards

- Converse uses a 1,200-token output cap. Mantle Chat Completions uses a
  2,000-token cap because GPT OSS reasoning tokens count toward the same limit;
  both remain well below the model maximum.
- Mantle requests use `response_format.type=json_object`. GPT OSS can still
  prepend a Markdown code fence, so the processor removes only that optional
  wrapper before applying the strict feedback schema validator.
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
aws login --profile speakup
aws bedrock list-foundation-models --profile speakup --region us-east-2 `
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
and Nova model availability were not the cause. Do not enable feedback in
`converse` mode while this Bedrock Runtime allowance remains exhausted, because
the workflow treats a failed required feedback stage as a failed recording.

The account has a separate quota on the Bedrock Mantle endpoint. A signed Chat
Completions request to `openai.gpt-oss-20b` succeeded on 2026-11-12, and a second
call through the processor's `_mantle_chat_completion` function also succeeded:
0.718 seconds, 171 input tokens, 36 output tokens, stop reason `stop`, and 32
characters of text. The response text was not recorded. The processor therefore
supports an explicit `mantle-chat` mode and does not silently fall back between
APIs or models. The Lambda role grants only `bedrock-mantle:CreateInference` on
account projects and restricts requests to the configured model with the
`bedrock-mantle:Model` condition. The Mantle path uses
`https://bedrock-mantle.us-east-2.api.aws/v1/chat/completions` and SigV4 service
`bedrock`, which matches the model card for `openai.gpt-oss-20b`.

## Local template validation (2026-11-12)

`cfn-lint` is not on `PATH`. The installed Python `cfnlint` API validated
`infra/speakup.yaml` for `us-east-2` with 0 errors, 0 warnings, and 0 info
messages. `cfn-guard` 3.2.1 is installed, but this repository has no Guard rules
file, so security and compliance rules were not evaluated. CloudFormation
service validation still runs when the change set is created. The template is
63,822 bytes, so the change set must use an S3 `--template-url`.

## Enable and verify

Enabling the flag changes the deployed stack and therefore requires explicit
team approval. Preserve every existing CloudFormation parameter. For the
current development account, upload a new immutable processor archive, then set
`BedrockInferenceMode=mantle-chat`, `BedrockModelId=openai.gpt-oss-20b`,
`EnableBedrockFeedback=true`, and the new `ProcessorCodeS3Key` plus
`ProcessorCodeS3Version`. Leave every other parameter on its previous value.
Do not edit the Lambda environment by hand, because a later stack update would
overwrite it. Do not leave the mode at `converse` while enabling feedback:
that path still targets Nova and the exhausted Bedrock Runtime allowance.

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
SSE-S3. No feedback artifact existed in this baseline because Bedrock was
deliberately disabled while the original Bedrock Runtime endpoint rejected model
invocations.

## Enabled Mantle deployment (2026-11-12)

CloudFormation change set `enable-mantle-feedback-20261112` updated
`speakup-dev` with no resource replacements. `describe-events` returned no
validation errors. The processor archive is:

`deployments/speakup-dev/processor-mantle-chat-d72bb4c5c1f6.zip`

The deployed processor uses `BEDROCK_INFERENCE_MODE=mantle-chat`,
`BEDROCK_MODEL_ID=openai.gpt-oss-20b`, and `ENABLE_BEDROCK_FEEDBACK=true`.
IAM simulation allowed `bedrock-mantle:CreateInference` for that model and
denied it for `amazon.nova-lite-v1:0`.

One real `SPEAKUP 2.m4a` upload then completed through the public API:

- Project: `cb502314-def5-45b5-88de-79d3ba57fc4a`
- Recording: `50c8358f-986d-5ca3-be20-90ab56e1f42c`
- Step Functions execution: `SUCCEEDED`
- `GenerateFeedback`: entered and exited in 2.61 seconds
- Upload-to-terminal processing: 56.602 seconds
- Transcript artifact: 92 timestamped items
- Analysis: 67 words, 116.86 WPM, 4 fillers, 11 pauses,
  `insufficient_speech`
- Feedback artifact: 1,761 characters
- Original download: SHA-256 matched the uploaded bytes

The public recording response still omits storage keys. DynamoDB status was
`COMPLETE` and its `feedback_s3_key` pointed at a versioned `feedback.json`
encrypted with SSE-S3. CloudWatch recorded `feedback.bedrock` `SUCCESS` for
this recording with stop reason `stop`, 447 input tokens, 626 output tokens,
and no transcript or feedback text. The privacy-safe runner log is
`results/live-e2e/pipeline-20261112T215554Z.jsonl`.

## Merged structured-feedback deployment (2026-11-15)

The branch was merged with the latest `origin/main` before final validation so
it preserves acoustic pause inputs and the version 2 structured coaching
artifact. The final processor archive is:

`deployments/speakup-dev/processor-mantle-fenced-json-5c615d20bdc7.zip`

CloudFormation change set `mantle-fenced-json-20261115` completed without any
resource replacement or deletion. A first merged-pipeline run exposed that GPT
OSS sometimes prefixes otherwise valid JSON with a Markdown code fence. The
final adapter uses JSON response mode, a bounded 2,000-token output cap, and a
narrow fence normalizer before the existing schema validation. A synthetic live
request confirmed the normalized response covered all four categories and used
valid anchored moments.

A final real 48 kHz `SPEAKUP 2.m4a` upload then passed through the public API and
automatic S3 trigger:

- Project: `757e3559-17f8-4ad9-8099-18df3ef4274c`
- Recording: `6809daaa-cff0-5427-a02d-ab841e10ab3c`
- Step Functions execution: `SUCCEEDED`
- Upload-to-terminal processing: 68.418 seconds
- Audio preprocessing: 41.861 seconds
- Transcribe start: 1.323 seconds
- Transcribe wait: 15.044 seconds
- Transcript check: 0.149 seconds
- Analytics: 0.424 seconds
- Structured Bedrock feedback: 4.919 seconds
- Transcript artifact: 92 timestamped items
- Analysis: 67 words, 116.86 WPM, 4 fillers, 11 pauses,
  `insufficient_speech`
- Feedback artifact: schema version 2, four categories, four anchored moments,
  and 17 copied metric fields
- Original download: SHA-256 matched the uploaded bytes

DynamoDB recorded `COMPLETE` and a versioned feedback reference. The 3,126-byte
feedback artifact is private, versioned, and encrypted with SSE-S3. CloudWatch
recorded `feedback.bedrock` `SUCCESS` in 4.634 seconds with 1,725 input tokens,
1,720 output tokens, and stop reason `stop`; the inspected messages contained no
transcript text, feedback text, credentials, or bearer tokens. The privacy-safe
runner log is `results/live-e2e/pipeline-20261116T052749Z.jsonl` (UTC filename).
