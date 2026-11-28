# SpeakUp

SpeakUp is a DS3 public-speaking coach. A student records or uploads a practice
talk, and SpeakUp scores three things on a 0 to 4 scale: speaking rate, filler
words, and pauses inside sentences. It then shows a timestamped transcript with
the fillers and pauses marked, plus written coaching feedback.

**Status:** the AWS backend is deployed for development, and the web app in
`frontend/web` can run in three ways: on sample data with no AWS, connected to
AWS through a local guest session, or connected to AWS with real accounts
(email and password, or Google). See [step 4](#4-run-the-web-app).

## Using SpeakUp

1. **Sign in.** Press **SIGN IN** in the top-right corner or open `/login`.
   Use your email and a
   password, or **Continue with Google** when it is turned on. New accounts get
   a 6-digit code by email to confirm. Your presentations and scores are saved
   to your account, so you can come back and see how you improve.
2. **Start a presentation.** Press **+ New presentation**. Give it a title if
   you want, then record with your microphone or upload an audio file (WAV,
   MP3, M4A, WebM or Ogg).
3. **Record.** A 3-2-1 countdown starts the recording. While you talk you see a
   live transcript and a rough speaking pace. You can pause, resume, listen
   back, or record again before you send it. The app uploads the saved audio
   when you press **Start presentation with audio**. A live speech service may
   receive microphone audio while you record to show the live transcript.
4. **Wait for the analysis.** The page shows each step as it finishes. Press
   **See results** when it is done.
5. **Read your results.** You get a 0 to 4 score for speaking rate, filler
   words and pauses inside sentences, one strength and one thing to work on,
   and the transcript with fillers and pauses marked. Click a marker or a
   sentence to hear that part of your talk.
6. **Practice again.** Press **New attempt** on the same presentation. Once two
   attempts are scored, charts show how each score changed.

You can also start with **PRACTICE** for a two-minute warm-up. Sign in before
recording to use the live transcript when AWS streaming is enabled. If you
already recorded a warm-up while signed out, use email sign-in to keep it.
Google sign-in leaves the recording page. The saved scores come from analysis
of the submitted audio. Live text and pace are estimates to use while speaking.

## How it works

![SpeakUp pipeline](docs/flowchart/speakup_flowchart.png)

1. The browser uploads the original recording straight to a private S3 bucket.
   The original is never changed.
2. The S3 upload event starts a Step Functions workflow.
3. **Audio prep** (Lambda container): converts the file to 48 kHz mono and
   removes background noise with DeepFilterNet3.
4. **Transcription:** Amazon Transcribe (en-US) returns the words with
   timestamps and punctuation.
5. **Scoring:** plain Python code in `src/scoring/` counts words per minute,
   fillers and pauses, then scores them with the rubric in
   [`src/scoring/rubrics/speaking-2026-10-31.csv`](src/scoring/rubrics/speaking-2026-10-31.csv).
6. **Feedback:** Amazon Bedrock writes structured coaching (an overview, four
   categories and timestamped moments) from the scores. It only runs when the
   stack is deployed with `EnableBedrockFeedback=true`. See
   [docs/bedrock-upload-pipeline.md](docs/bedrock-upload-pipeline.md).
7. Results are saved to S3 and DynamoDB, and the web app reads them through
   API Gateway after the user signs in with Cognito.

Step by step detail: [docs/full-pipeline-walkthrough.md](docs/full-pipeline-walkthrough.md).

## Models and why we picked them

| Step | Model | Why |
| --- | --- | --- |
| Noise cleanup | DeepFilterNet3 | Removes background noise while keeping speech intact, and runs on CPU inside Lambda |
| Speech to text | Amazon Transcribe (en-US) | Keeps um and uh in the transcript and gives word timestamps and punctuation. Caught 87.6% of hand-labeled um/uh in our test, vs about 10% for plain Whisper. See [below](#speech-to-text-transcribe-vs-crisperwhisper) for why we did not switch to CrisperWhisper |
| Pause detection | A quiet stretch of 0.3 s or more (energy), or Silero VAD hearing no speech at a Transcribe word gap | Silero also catches pauses filled with laughter, clapping or breathing, which are not quiet. A pause counts against the score unless it comes after a period, question mark, exclamation mark or comma. A pause right after um/uh, or a comma pause before repeated words ("by saving, saving money"), still counts. Falls back to Transcribe word gaps when the audio-prep step has no pause data |
| Feedback | Amazon Bedrock: Nova Lite (`converse` mode) or `openai.gpt-oss-20b` through the Mantle endpoint (`mantle-chat` mode) | Runs in our Region (`us-east-2`). Mantle was added because the dev account hit Bedrock Runtime's daily token limit. The scores come from code, so the model only writes the wording |

### Speech to text: Transcribe vs CrisperWhisper

CrisperWhisper is a Whisper model tuned to write filler words, so we tested
whether it would score speech better than Transcribe. We are keeping Transcribe.

**Fillers.** We used the 8 test episodes of the public PodcastFillers dataset
(first 20 minutes each), where 830 um/uh were labeled by hand. A label counts as
caught when the model writes um/uh within 0.35 s of it.

| Model | Labeled um/uh caught | um/uh written | Written with no label nearby |
| --- | --- | --- | --- |
| Amazon Transcribe | 87.6% | 820 | 11% |
| CrisperWhisper 2.0 turbo | 92.2% | 908 | 15% |
| CrisperWhisper 2.0 small / medium / large | 92.3 to 93.1% | 933 to 971 | 16 to 19% |
| Whisper with a verbatim prompt (4 episodes) | 82.8% | 406 (436 labeled) | 11% |

CrisperWhisper catches about 5 points more of the labeled fillers, but it also
writes more um/uh with no label nearby, so its total runs high (908 or more vs
830). Transcribe's total is closer, and the filler score is based on the total.
Some unlabeled um/uh may be real fillers the labelers skipped, so the last
column is an upper bound on false alarms.

**Pauses and WPM.** On 220 hand-labeled pauses, CrisperWhisper's punctuation
agreed with our labels 85 to 86% of the time, the same as Transcribe (86%).
Seven open punctuation models gave 81 to 87%, which is within noise. Word counts
were within about 1.5% of Transcribe's, so WPM would barely change.

**Why we did not switch.** The filler gain is small and comes with more extra
fillers. CrisperWhisper 2.0 is licensed for non-commercial research only and
would need its own GPU hosting, while Transcribe already runs in the pipeline.

The research behind every rubric cutoff, the filler word list, the pause rules
and the Bedrock prompt is in [docs/research/](docs/research/README.md). Start
with [RUBRIC_README.md](docs/research/RUBRIC_README.md).

## Setup

You only need the steps for the part you are working on.

| I want to... | Steps |
| --- | --- |
| Run the tests or work on scoring and the API code | 1, 2, 3 |
| Work on the web app | 1, 4 |
| Run noise cleanup on my own audio | 1, 5 |
| Run a recording through the real AWS pipeline | 1, 2, 6, 7 |
| Deploy or change AWS resources | 1, 2, 6, then [infra/README.md](infra/README.md) |

### 1. Install the tools and clone the repo

You need Git, plus:

- **Python 3.13** for the main code and tests
- **Python 3.11** only for noise cleanup (DeepFilterNet needs it)
- **Node.js 20.9 or newer** only for the web app
- **AWS CLI 2.32 or newer** only for AWS work

On macOS with Homebrew:

```bash
brew install git python@3.13 python@3.11 node awscli
```

On Windows, install the same tools from their websites. Then:

```bash
git clone https://github.com/sux005/DS3_SpeakUp.git
cd DS3_SpeakUp
```

### 2. Set up Python and run the tests

macOS and Linux:

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
cp .env.development.example .env.development
```

Windows PowerShell:

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
Copy-Item .env.development.example .env.development
```

Run the tests:

```bash
python -m pytest -q --basetemp .test-tmp -p no:cacheprovider
```

Everything should pass. The tests do not need AWS, audio files or model downloads.

`.env.development` holds resource names, not passwords. Never put AWS keys in it.

### 3. Score a transcript on your computer

The same scoring code the AWS pipeline uses can run on any transcript with word
timestamps (raw Amazon Transcribe JSON, a SpeakUp transcript, or local Whisper
output):

```bash
python scripts/calculate_wpm.py frontend/sample-payloads/transcript.json
python scripts/count_fillers.py frontend/sample-payloads/transcript.json
```

The sample transcript is only five words long, so it prints
`"rubric_status": "insufficient_speech"` and no score. Use a real transcript to
get scores.

To make a transcript from your own audio without AWS, install the optional
Whisper model and see [Local transcription](#local-transcription-and-accuracy-review):

```bash
pip install -r requirements-transcription.txt
```

### 4. Run the web app

```bash
cd frontend/web
npm install
npm run dev
```

Open http://localhost:3000. Pick how it runs:

| Mode | What you need | What happens |
| --- | --- | --- |
| Sample data (default) | Nothing | Uses `frontend/web/data/`. Recordings stay in your browser and get no real scores |
| Live, guest session | AWS access ([step 6](#6-get-aws-access)) | Your local server talks to the dev stack for you. No sign-in |
| Live, with accounts | The stack's Cognito IDs | People sign in, and each person's recordings are stored under their account |

For the guest session, run this instead of `npm run dev` (it only works on your
own computer, never in production):

```bash
AWS_PROFILE=speakup-dev SPEAKUP_DEV_GUEST_MODE=1 NEXT_PUBLIC_SPEAKUP_API_URL=/api/speakup npm run dev
```

For accounts, put these in `frontend/web/.env.local`. The values come from the
stack outputs (`UserPoolId`, `UserPoolClientId`, the API URL and, for Google,
`CognitoDomain`). None of them are secrets:

```bash
NEXT_PUBLIC_SPEAKUP_API_URL=https://<api-id>.execute-api.us-east-2.amazonaws.com
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-2_xxxxxxxxx
NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
# Only when Google sign-in is turned on in the stack:
NEXT_PUBLIC_COGNITO_DOMAIN=<stack>-<id>.auth.us-east-2.amazoncognito.com
```

The API only accepts requests from the stack's `CorsAllowedOrigin`
(`http://localhost:3000` by default), so a hosted copy of the site needs the
stack redeployed with its URL. Turning on Google sign-in is covered in
[infra/README.md](infra/README.md#google-sign-in-optional-off-by-default).

The results page plays a demo talk that is not in the repo, because we don't
commit audio. Without it the page still works and shows a "No audio file found"
note. To add it, see "Demo audio" in [frontend/web/README.md](frontend/web/README.md). Screens, file layout and
tests are in [frontend/web/README.md](frontend/web/README.md), and the API it
calls is in [docs/aws-payload-api.md](docs/aws-payload-api.md).

### 5. Run noise cleanup on your own audio

DeepFilterNet needs its own Python 3.11 environment. Keep it separate from `.venv`.

macOS and Linux:

```bash
python3.11 -m venv .venv-audio-v2
source .venv-audio-v2/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-audio-model.txt
python -m src.audio.preprocess path/to/recording.wav results/prepared
```

Windows PowerShell:

```powershell
py -3.11 -m venv .venv-audio-v2
.\.venv-audio-v2\Scripts\python -m pip install -r requirements-audio-model.txt
.\.venv-audio-v2\Scripts\python -m src.audio.preprocess path\to\recording.wav results\prepared
```

The output files are explained in [Audio preparation](#audio-preparation).
`results/` is ignored by Git, so your audio stays on your computer.

### 6. Get AWS access

Ask the project lead for your own AWS sign-in. Never share logins or create
access keys. Then:

```bash
aws login --profile speakup-dev
aws sts get-caller-identity --profile speakup-dev
```

Use Region `us-east-2` for every command. Details and troubleshooting:
[docs/team-aws-access.md](docs/team-aws-access.md).

### 7. Run a recording through the real pipeline

With `.venv` active and AWS access working:

```bash
python scripts/run_live_pipeline.py path/to/recording.wav
```

The script makes a test user, uploads the file the same way the web app will,
waits for the workflow to finish and saves a log of every step. Add
`--log path/to/log.jsonl` to choose where the log goes.

### Setup problems

Most install problems on Mac (PyTorch, DeepFilterNet, missing Python versions,
Docker on Apple Silicon) are covered in [docs/macos-setup.md](docs/macos-setup.md).

## Repository structure

```text
.
├── docs/
│   ├── research/            # Why the rubric, models and prompt are what they are
│   ├── flowchart/           # Pipeline diagram
│   └── *.md                 # API contract, pipeline walkthrough, AWS and setup guides
├── frontend/
│   ├── sample-payloads/     # Example API responses
│   └── web/                 # Next.js web app
├── infra/                   # CloudFormation templates and Lambda handlers
├── scripts/                 # Local scoring, QA, packaging and live pipeline runs
├── src/
│   ├── audio/               # Audio prep and noise cleanup
│   ├── aws_payload/         # Storage and recording lifecycle code for S3 and DynamoDB
│   ├── scoring/             # Rubric, fillers, pauses and the rubric CSV
│   └── transcription/       # Optional local Whisper transcription
├── tests/
├── notebooks/
├── results/                 # Local outputs, ignored by Git
└── models/                  # Downloaded model files, ignored by Git
```

## Docs

| Doc | What it covers |
| --- | --- |
| [docs/full-pipeline-walkthrough.md](docs/full-pipeline-walkthrough.md) | Every step from upload to results, and which file does it |
| [docs/aws-payload-api.md](docs/aws-payload-api.md) | API routes and response shapes for the frontend |
| [frontend/sample-payloads/](frontend/sample-payloads/README.md) | Example response for every API route |
| [docs/aws-payload-package-reference.md](docs/aws-payload-package-reference.md) | Every function in `src/aws_payload` |
| [docs/rubric-csv-format.md](docs/rubric-csv-format.md) | How to edit the rubric CSV |
| [docs/research/](docs/research/README.md) | Rubric, filler, pause and prompt research |
| [infra/README.md](infra/README.md) | Deploying, Lambda packages, the audio image, costs and cleanup |
| [docs/team-aws-access.md](docs/team-aws-access.md) | Getting AWS access |
| [docs/sign-in-process.md](docs/sign-in-process.md) | How sign-in works |
| [docs/bedrock-upload-pipeline.md](docs/bedrock-upload-pipeline.md) | The Bedrock feedback step, its modes and how to turn it on |
| [docs/research/noise_cancellation_ab.md](docs/research/noise_cancellation_ab.md) | How to compare raw and cleaned audio |
| [docs/macos-setup.md](docs/macos-setup.md) | Mac setup and fixes |
| [docs/AGENTS.md](docs/AGENTS.md) | Repo guide for AI coding tools |


## Audio preparation

The audio-prep step sends 48 kHz mono audio to DeepFilterNet3. It uses the
cleaned audio when it passes a speech-preservation check, and otherwise falls
back to a dry/cleaned blend or the plain normalized audio. The original
recording is never overwritten.

Set up `.venv-audio-v2` as in [setup step 5](#5-run-noise-cleanup-on-your-own-audio), then:

```bash
python scripts/generate_audio_prep_example.py   # synthetic before/after example
python scripts/run_real_audio_qa.py             # private data/raw/SPEAKUP 1-6.mp4 clips
```

The example writes `reference.wav`, `enhanced_model.wav`, `enhanced_blended.wav`,
`diagnostic.wav` and a `report.json` that records the model settings, the
speech-preservation checks and which signal was picked. Real-clip QA goes to
`results/real_audio_qa/<clip>/` (ignored by Git) and are only rerun when the
input or settings change.

To make a level-matched A/B listening file:

```bash
python scripts/create_audio_ab_example.py \
  results/prepared/reference.wav results/prepared/diagnostic.wav \
  results/prepared/ab_example.wav
```

The old RNNoise backend is optional (`requirements-rnnoise.txt`, macOS 15 or newer).

## Local transcription and accuracy review

This uses local Whisper (`small.en`), not Transcribe, so you can test without AWS.

```bash
pip install -r requirements-transcription.txt
python scripts/transcribe_local.py          # writes results/local_transcripts/<clip>/transcript.json
python scripts/create_review_templates.py   # prefills data/references/SPEAKUP x.json
```

A model transcript is a guess, not ground truth. To check accuracy, listen to
the recording, fix the `text` in the reference file and set
`"review_status": "reviewed"`, then compare:

```bash
python scripts/check_transcript_accuracy.py \
  "results/local_transcripts/SPEAKUP 1/transcript.json" \
  "data/references/SPEAKUP 1.json"
```

The checker rejects a reference whose source hash does not match. To check word
timestamps, play that stretch of audio, for example
`ffplay -ss 10 -t 5 -autoexit "data/raw/SPEAKUP 1.mp4"`.

`calculate_wpm.py` and `count_fillers.py` (setup step 3) work on these
transcripts too. Filler words are left out of the WPM word count, and the score
bands come from the rubric CSV ([format](docs/rubric-csv-format.md)).

The full local test is opt-in because it runs all six private clips and
downloads `small.en` the first time:

```bash
SPEAKUP_RUN_LOCAL_E2E=1 python -m pytest -q tests/test_local_audio_e2e.py
```

## Contributing

- Make an Issue for each task or bug, and work on your own branch
  (`git checkout -b feature/my-task`).
- Pull `main` before you start, keep commits small, and open a pull request
  into `main` early so people can comment.
- Only the project managers or mentors approve and merge pull requests.
- Put reusable code in `src/` and add tests for it. Keep notebooks for exploring.
- Never commit secrets, API keys, audio or large data files.
