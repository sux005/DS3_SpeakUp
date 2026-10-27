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

## How to fill this out (do this now)

This file is a **template**. Go through every `[bracketed placeholder]`
below and replace it with real info about your specific project — nobody
else can fill this in for you, since every DS3 project is different. Keep
the sections short and factual; don't write paragraphs the agent doesn't
need. If a command doesn't work, the agent will trust it and waste time —
so actually run each command yourself before writing it down.

Where this file goes: **the repo root**, named exactly `AGENTS.md`. If
your project ever splits into clearly separate sub-projects (e.g. a
`frontend/` and a `models/` pipeline that are basically unrelated), you
can also drop an additional `AGENTS.md` inside a subfolder — the agent
uses the one closest to the file it's working on.

Nothing tool-specific to install — Claude Code, Cursor, and Codex all
read `AGENTS.md` at the repo root automatically, no setup needed. (Claude
Code will also read a `CLAUDE.md` if present, and Cursor also honors
`.cursor/rules/` — but for a shared team repo, put the real content here
so it works everywhere, and keep the others as thin pointers to this file
if you need tool-specific extras.)

<!-- ============================================================
     TEMPLATE STARTS HERE — this is what the agent actually reads.
     Replace every [bracketed] placeholder below.
     ============================================================ -->

# AGENTS.md

## Project overview

[One or two sentences: what does this project do, and for whom? e.g.
"A pipeline that predicts campus dining hall wait times from historical
swipe data, built for UCSD Housing & Dining."]

**Status:** [prototype / active development / deployed]
**Primary language(s)/framework(s):** [e.g. Python 3.11, pandas,
scikit-learn, FastAPI, React]

## Repo structure

This project follows the DS3 project template
(https://github.com/ucsdds3/ds3-project-template). Reusable logic lives
in `src/`; notebooks are for exploration and should import from `src/`
rather than redefining logic inline.

```
.
├── README.md
├── .env.example
├── requirements.txt
├── notebooks/        # exploration, EDA, prototyping — not the source of truth for pipeline logic
├── src/               # the actual reusable code — import this from notebooks
├── tests/             # pytest-style tests for src/
├── data/
│   ├── raw/           # never edit by hand, never overwrite
│   └── processed/
├── results/
├── models/
├── frontend/          # [delete this line if unused] UI/web app code
└── infra/             # [delete this line if unused] deployment/cloud config
```

[Adjust the tree above to match what you actually have, and delete rows
that don't apply, e.g. no `frontend/` if there's no UI.]

## Dev environment / setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.development.example .env.development
```

Use `.env.production.example` as the production schema after the production
CloudFormation stack is deployed. Never commit `.env.development` or
`.env.production`, and never put AWS access keys in either file; local AWS CLI
access uses the short-lived `speakup-dev` profile.

## Running things

- Run the main pipeline: `[e.g. python -m src.pipeline]`
- Launch notebooks: `jupyter lab notebooks/`
- [Any other entry point: a Streamlit app, a FastAPI server, a training
  script — give the exact command.]

## Testing

- Unit tests live in `tests/` and run with:
  ```bash
  pytest
  ```
- Some validation also happens inline in notebooks (e.g. sanity-checking
  shapes/values after a transform) — [say which notebooks, if any, are
  load-bearing for correctness rather than pure exploration].
- Before opening a PR: run `pytest` and make sure it passes. New logic in
  `src/` should come with a test — either in `tests/` or a clear
  assertion-based check in the relevant notebook.

## Code style & conventions

- Follow PEP 8. [`ruff check src/` / `flake8 src/` if the team uses a
  linter — say which one.]
- Every public function/class in `src/` needs a docstring (what it does,
  params, return value).
- No magic numbers in logic — use a named constant or a config value, and
  say where the number comes from if it's empirical (e.g. a tuned
  threshold).
- [Any project-specific conventions: naming schemes for experiment
  outputs, a required random seed for reproducibility, a specific
  logging setup, etc.]

## Git / PR workflow

- One GitHub Issue per task/bug/feature.
- Work happens on a branch (`feature/your-task`), never directly on
  `main`.
- Open a PR when ready; **only mentors/PMs approve and merge to `main`**
  — do not merge your own PR even if checks pass.
- Before opening a PR, it's worth running the `ds3-code-review` skill on
  your branch to catch structure/style/testing issues yourself first.

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
- [Add anything else specific to your project — e.g. "never regenerate
  `results/` files without being asked, they're checked in as the record
  of the last approved run."]
- Never finish a task that changed structure/commands/conventions
  without also updating AGENTS.md — see "Keeping this file up to date"
  above.

## Useful context

[Anything else an agent (or new teammate) would want to know: links to a
`DesignDoc.md`, the dataset's source/license, known gotchas, an
in-progress area of the code that's intentionally unfinished, etc.]
