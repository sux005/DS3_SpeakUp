<!-- ============================================================
     👋 HUMAN-READ SECTION — read this yourself first. Delete this
     whole block (down to the divider) once you're done, or leave
     it — agents will just skip past an HTML comment either way.
     ============================================================ -->

# For DS3 Students: What Is AGENTS.md and Why Does This Repo Have One?

## The problem it solves

Every AI coding tool invented its own file for "here's context about my
project, please read this first": Cursor uses `.cursorrules`, Claude Code
uses `CLAUDE.md`, GitHub Copilot uses `.github/copilot-instructions.md`,
and so on. If you used more than one tool, you had to write the same
instructions multiple times in multiple formats.

**`AGENTS.md`** is the fix: a single, open, cross-tool standard — think of
it as **a README, but written for an AI agent instead of a human**. It was
put together by the teams behind OpenAI Codex, Cursor, Google, and others
specifically so you write your project instructions *once* and every
major coding agent (Claude Code, Cursor, Codex, Copilot, and more) reads
the same file. As of writing, tens of thousands of repos use it and
~20+ tools support it natively.

## What it's for

When an agent opens your repo, it has no idea:
- what the project actually does or who it's for
- how to install dependencies and run things
- where "real" code lives vs. scratch/exploration code
- how your team runs tests
- what conventions you follow (style, structure, docstrings...)
- what it should *never* do (touch `main` directly, commit secrets, etc.)

`AGENTS.md` answers all of that up front, once, so you don't have to
re-explain your project in every single chat with every tool. The agent
auto-discovers it just by being in the repo — you don't have to `@`
mention it (though you still can, to be explicit).

## Why DS3 wants you comfortable with this

- **It's now industry standard.** Understanding how to write good agent
  instructions — clear, specific, scoped, not overly long — is a real
  skill you'll use at any internship or job that touches AI tooling.
- **It's portable.** Whatever tool you or a future teammate prefers
  (Claude Code, Cursor, Codex, Copilot...), the same file works. You're
  not locked into one assistant.
- **It documents your project for humans too.** A well-written AGENTS.md
  is often just as useful for a new teammate joining the project as it is
  for an AI agent.
- **It's the difference between "the agent guesses" and "the agent
  knows."** Vague instructions produce vague/wrong help. Specific ones —
  "run `pytest` from the repo root," not "run tests" — get you working
  code the first time.

## Keep it alive — this is not a one-time setup step

A stale AGENTS.md is worse than none at all: it actively lies to the next
person (or agent) who trusts it. Every teammate on this project — and
every agent they work with — reads the *same* file, so it has to stay
accurate as the project actually changes.

**The rule: any time an agent (or you) adds a feature, changes how
something is run/tested, changes the structure, or adds a new
dependency/convention, AGENTS.md gets updated in the same PR.** Not
"eventually," not "someone else's job" — the same change that made the
file outdated is responsible for fixing it. See the instruction to this
effect in the template below; don't delete it.

## AGENTS.md vs. the `ds3-code-review` skill

These are two different things and both matter:
- **`AGENTS.md`** = standing context about *this whole project* (what it
  is, how to run it, conventions). The agent reads it automatically for
  *any* task in this repo.
- **`SKILL.md` files** (like `ds3-code-review`) = instructions for one
  *specific task* — in this case, running a strict read-only code review.
  You (or the agent) reach for it only when that specific job comes up.

A good mental model: AGENTS.md is "everything you need to know to work in
this repo," a skill is "here's exactly how to do this one thing well."

## Where this guidance applies

The project-specific instructions below apply to work under `docs/`.
Keep commands and architecture claims synchronized with the repository.
The frontend has additional guidance in `frontend/web/AGENTS.md`.

<!-- ============================================================
     PROJECT INSTRUCTIONS START HERE.
     ============================================================ -->

# AGENTS.md

## Project overview

SpeakUp is a DS3 public-speaking diagnostics platform. It prepares recordings
for analysis, derives transcript-based speech metrics, and stores versioned
coaching results in a private serverless AWS backend.

**Status:** active development; development AWS stack exists
**Primary language(s)/framework(s):** Python 3.13 Lambda, isolated Python 3.11
DeepFilterNet audio worker, boto3, librosa, DynamoDB, S3, Step Functions,
CloudFormation

## Repo structure

This project follows the DS3 project template
(https://github.com/ucsdds3/ds3-project-template). Reusable logic lives
in `src/`; notebooks are for exploration and should import from `src/`
rather than redefining logic inline.

```
.
├── README.md
├── .env.development.example
├── requirements.txt
├── notebooks/        # exploration, EDA, prototyping — not the source of truth for pipeline logic
├── src/               # the actual reusable code — import this from notebooks
├── tests/             # pytest-style tests for src/
├── data/
│   ├── raw/           # never edit by hand, never overwrite
│   └── processed/
├── results/
├── models/
├── frontend/          # UI/web app work area
└── infra/             # CloudFormation and Lambda adapters
```

## Dev environment / setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.development.example .env.development
```

DeepFilterNet-backed local audio processing uses a separate Python 3.11 environment
with the self-contained `requirements-audio-model.txt`; do not combine it with the
Python 3.13 `requirements.txt`. The normal test environment does not need to install
PyTorch or native model wheels.

For the local frontend demo, use Node.js 20.9 or newer and run `npm ci` in
`frontend/web/`. The frontend uses Next.js, Vitest, React Testing Library, and
Playwright. It supports sample data and a development API bridge; the bridge
requires guest mode and is disabled in production. Transcript review uses
timed words with filler highlighting, filters, and click-to-seek playback.
Recording, the single start/resume countdown, Pause / Resume, preview, retake
confirmation, and provisional live transcript and pace run in the browser. Pause
freezes active recording time; the live filler estimate is no longer shown.
Live-mode page load still reads session, projects, and limits;
**Start presentation with audio** triggers project creation and audio
upload. With `NEXT_PUBLIC_SPEAKUP_AWS_STREAMING=1`, the authenticated recorder
uses a short-lived AWS Transcribe WebSocket session. Otherwise browser speech
recognition may use a vendor service. The retake prompt
preference is browser `localStorage`, not backend account state.

Use `.env.production.example` as the production schema after the production
CloudFormation stack is deployed. Never commit `.env.development` or
`.env.production`, and never put AWS access keys in either file; local AWS CLI
access uses the short-lived `speakup` profile.

## Running things

- Run model-backed audio preparation with the Python 3.11 environment:
  activate `.venv-audio-v2`, then run
  `python -m src.audio.preprocess <input> <output-dir>`
- Run local six-clip QA with duplicate skipping:
  activate `.venv-audio-v2`, then run
  `python scripts/run_real_audio_qa.py`
- Compare existing Whisper or Transcribe raw/enhanced transcript files with
  `python scripts/compare_noise_cancellation.py <raw.json> <enhanced.json>`.
  Add `--reference-text <reviewed.txt>` before interpreting either condition as
  more accurate.
- Run a local Whisper A/B transcription with
  `python scripts/transcribe_noise_cancellation_pair.py <raw-audio> <enhanced-audio> --output-dir <dir>`.
- Build Lambda packages: `python scripts/build_lambda_packages.py`
- Calculate transcript WPM: `python scripts/calculate_wpm.py <transcript.json>`
- Count transcript fillers: `python scripts/count_fillers.py <transcript.json>`
- Run a bounded, content-safe Bedrock Runtime availability check with
  `python scripts/smoke_test_bedrock.py` after signing in to the `speakup-dev`
  profile. The deployed pipeline may instead use the signed Bedrock Mantle
  endpoint selected by the `BedrockInferenceMode` stack parameter.
- Launch notebooks: `jupyter lab notebooks/`
- Validate locally: `python -m pytest -q --basetemp .test-tmp -p no:cacheprovider`
- Validate the frontend from `frontend/web/`: `npm run lint` and
  `NEXT_PUBLIC_SPEAKUP_API_URL= npm run test:all` (coverage-gated
  unit/integration tests, demo-mode production build, and Playwright browser
  tests). `npm run test:e2e` alone requires a prior demo-mode build. If
  `.env.local` sets the live bridge URL, explicitly clear it for demo browser
  tests. In environments that restrict Turbopack worker ports, use
  `npx next build --webpack` for a compilation check; this webpack fallback
  does not apply the project's Turbopack Tailwind loader for visual checks.
- Opt-in deployed workflow smoke test: set `SPEAKUP_LIVE_E2E=1`,
  `SPEAKUP_E2E_API_URL`, `SPEAKUP_E2E_JWT`, and `SPEAKUP_E2E_WAV_PATH` to a
  non-private spoken-English WAV, then run
  `python -m pytest -q tests/test_live_backend_e2e.py`.
- Opt-in deployed API storage checkpoints: set `SPEAKUP_LIVE_API=1`,
  `SPEAKUP_E2E_API_URL`, and `SPEAKUP_E2E_JWT`, then run
  `python -m pytest -q tests/test_live_backend_e2e.py`. This test generates
  non-private synthetic WAV bytes and does not start processing.

## Testing

- Unit tests live in `tests/` and run with:
  ```bash
  pytest
  ```
- Notebooks are exploratory and are not load-bearing for correctness.
- Before opening a PR: run `pytest` and make sure it passes. New logic in
  `src/` should come with a test — either in `tests/` or a clear
  assertion-based check in the relevant notebook.
- macOS and Linux use `.venv/bin/activate`; Windows PowerShell uses
  `.venv\Scripts\Activate.ps1`. Model-backed work uses CPython 3.11 on every
  platform. Keep PyTorch requirement markers compatible with macOS plain wheels
  and Linux/Windows `+cpu` wheels.

- Frontend unit, component, and route integration tests live in
  `frontend/web/tests/`; browser tests live in `frontend/web/e2e/`. Run
  `npm run test:all` from `frontend/web/` before opening a frontend PR.
- The frontend's development guest bridge uses `NEXT_PUBLIC_SPEAKUP_API_URL=/api/speakup`
  and `SPEAKUP_DEV_GUEST_MODE=1`; it is disabled in production. Run
  `npm run test:e2e:live` from `frontend/web/` to check the live-mode browser
  flow with intercepted API and S3 requests, without contacting AWS.

## Code style & conventions

- Follow PEP 8. The repository does not currently pin a separate linter.
- Every public function/class in `src/` needs a docstring (what it does,
  params, return value).
- No magic numbers in logic — use a named constant or a config value, and
  say where the number comes from if it's empirical (e.g. a tuned
  threshold).
- Build AWS payload keys only through `src/aws_payload/keys.py`; callers never
  choose buckets, tables, indexes, or raw keys.
- Keep HTTP recording responses on the explicit public serializer in the API
  adapter; do not return DynamoDB items, payload references, or workflow IDs.
- Keep the curated example catalog read-only and fixed to reviewed recordings;
  never turn example routes into arbitrary cross-user recording lookups.
- Completed review responses include transcript and summary metrics; feedback is
  null when no feedback artifact exists.
- Ground Bedrock coaching in persisted metrics and the matching rubric CSV bands.
  General feedback is unscored; pace, scored filler rate, and inside-sentence
  pause rate use their existing calculator scores.
- Share checksum parsing and active-workflow status rules through
  `src/aws_payload/checksum.py` and `src/aws_payload/policy.py`.
- Require `content_length` for HTTP upload reservations; sign it into the PUT,
  verify it on confirmation, and keep prepared audio writes immutable.
- Keep Step Functions stages replay-safe: reuse deterministic Transcribe jobs and
  build-identified versioned artifacts, bound polling, and record terminal
  failures through the workflow, EventBridge fallback, and stale-workflow
  reconciler. Active workflows cannot be soft-deleted.
- Keep Regional AWS resources in the project's selected Region, `us-east-2`.
- Pauses: the audio-prep worker stores `pause_inputs` (energy silences + Silero VAD
  speech, `src/audio/pause_detection.py`) in its report; the processor passes them to
  `score_transcribe_items(..., acoustic=...)`. Missing inputs fall back to Transcribe
  word gaps. Acoustic intervals count only within transcript word gaps, and
  `pause_detection_method` says which ran. `silero-vad` lives only in
  the audio worker requirements.
- Never log audio bytes, transcript text, credentials, or pre-signed URLs.

## Git / PR workflow

- One GitHub Issue per task/bug/feature.
- Work happens on a branch (`feature/your-task`), never directly on
  `main`.
- Open a PR when ready; **only mentors/PMs approve and merge to `main`**
  — do not merge your own PR even if checks pass.
- Before opening a PR, run a code review workflow if available, or use the
  DS3 checklist in `docs/codeReviewer.md` to catch issues on your branch.

## Keeping this file up to date

**This is a standing instruction, not optional:** whenever you (the
agent) make a change that affects anything described above — adding a
feature, changing/adding a run or test command, restructuring folders,
adding a dependency, changing a convention — update the relevant section
of this AGENTS.md as part of the same change, before considering the
task done. Do this even if the person didn't explicitly ask you to.

- Keep edits factual and short — update the specific section that's now
  wrong, don't rewrite the whole file.
- If you're unsure whether something is worth documenting here, prefer
  documenting it — the cost of a stale file for the next teammate/agent
  is higher than a slightly-too-detailed one.
- If your change conflicts with something already written here (e.g. you
  changed the test command), fix the existing text rather than leaving
  both the old and new versions in.
- Mention in your summary to the user that you updated AGENTS.md, so
  they can sanity-check it before it lands in the PR.

## Things the agent should never do in this repo

- Never commit or hardcode secrets, API keys, or `.env` contents.
- Never push directly to `main` or merge a PR.
- Never delete or overwrite anything in `data/raw/`.
- Never install packages beyond what's needed without calling it out and
  updating `requirements.txt`.
- Never run the owner-index backfill with `--apply`, deploy a stack, or
  permanently purge recordings without an explicit user request.
- Never finish a task that changed structure/commands/conventions
  without also updating AGENTS.md — see "Keeping this file up to date"
  above.

## Useful context

See `docs/aws-payload-api.md` for the storage contract and staged GSI migration,
`docs/aws-payload-package-reference.md` for the complete function-level Python
reference, `docs/aws-api-file-flowchart.md` for the editable AWS API file and
runtime dependency map, `src/aws_payload/README.md` for a concise API overview, and
`infra/README.md` for packaging, deployment, cost, and cleanup. See
`docs/sign-in-process.md` for app-user and developer authentication and
`docs/bedrock-upload-pipeline.md` for Bedrock diagnosis and end-to-end
verification. `docs/research/README.md` indexes the
research behind the rubric cutoffs, the proposed pause method, and the Bedrock
prompt. The development pipeline has completed live Amazon Transcribe runs. Its
Bedrock Runtime quota remains unavailable, so the deployed `speakup-dev` stack
enables feedback through the separately quota-managed Bedrock Mantle endpoint.
Preserve `BedrockInferenceMode=mantle-chat` when updating that stack.
