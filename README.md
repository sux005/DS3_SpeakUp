# DS3 Project Template

A clean starter template for data science and machine learning projects at UC San Diego's DS3.

## What this template includes

- A sensible folder structure for notebooks, source code, data, and outputs
- A Python environment file for quick setup
- A .gitignore tailored for secrets, notebooks, and generated artifacts
- A small starter package and test example

## Suggested repository structure

```text
.
├── README.md
├── .env.example
├── .gitignore
├── requirements.txt
├── notebooks/
│   └── README.md
├── src/
│   ├── __init__.py
│   └── example.py
├── frontend/
│   └── README.md
├── infra/
│   └── README.md
├── data/
│   ├── raw/
│   └── processed/
├── results/
├── models/
└── tests/
```

- `frontend/` is for UI/UX code and web app assets.
- `infra/` is for deployment scripts, cloud config, and infrastructure as code for AWS/GCP.

## Quick start

1. Create a virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Copy the example environment file:
   ```bash
   cp .env.development.example .env.development
   ```
   On Windows PowerShell, use `Copy-Item .env.development.example .env.development`.
   The development example contains the deployed stack's non-secret resource identifiers.
   `.env.development` and `.env.production` are ignored by Git; only their `.example`
   schemas belong on GitHub. The production example remains blank until `speakup-prod`
   is deployed, so development resources cannot be used accidentally in production.

   Do not place AWS access keys in an env file. For local AWS CLI access, use the
   short-lived `speakup-dev` profile documented in `infra/README.md`.
4. Start working in notebooks or in the src package.

## Audio preparation

SpeakUp includes a distortion-gated speech preparation pipeline. RNNoise performs
full-band noise suppression, while librosa and SciPy handle resampling, gentle EQ,
level control, and measurements. A dry-signal blend preserves consonants and room
tone, and the pipeline falls back to the conditioned reference when enhancement
introduces excessive spectral variation. The original recording is never overwritten.

Run it locally with:

```powershell
python -m src.audio.preprocess path\to\recording.wav results\prepared
```

Generate the deterministic before/after example with:

```powershell
python scripts\generate_audio_prep_example.py
```

The output directory contains `reference.wav`, `enhanced_model.wav`,
`enhanced_blended.wav`, `diagnostic.wav`, a legacy `enhanced.wav` alias, and
`report.json`. The report records the pipeline version, exact configuration,
latency compensation, speech-preservation measurements, warnings, and which signal
passed the distortion-aware transcription gate.

Create a level-matched listening example with:

```powershell
python scripts\create_audio_ab_example.py `
  results\prepared\reference.wav results\prepared\diagnostic.wav `
  results\prepared\ab_example.wav
```

## Repository guidelines

- Keep notebooks for exploration and visualization.
- Put reusable logic in src so notebooks stay readable.
- Do not commit secrets, API keys, or large data files.
- Use clear filenames and short, documented functions.
- Add tests for any core logic that will be reused.

## Git and GitHub workflow for DS3 projects

Using Git and GitHub well is just as important as writing good code. A clean workflow makes collaboration easier and helps the project stay organized.

### 1. Use GitHub Issues for tracking work

Create an Issue for each task, bug, experiment, or feature request. Keep each issue focused and include:

- a short title
- a clear description of the work
- acceptance criteria if relevant
- labels such as bug, enhancement, documentation, or blocked

Example workflow:
- one issue for data cleaning
- one issue for model training
- one issue for documentation updates

### 2. Use branches to separate work

Each person or feature should usually work in its own branch. This prevents people from overwriting each other's changes.

Common branch commands:

```bash
git branch
git checkout -b feature/my-task
git checkout main
git branch -d feature/my-task
```

What they mean:
- `git branch` shows existing branches
- `git checkout -b feature/my-task` creates and switches to a new branch
- `git checkout main` switches back to the main branch
- `git branch -d feature/my-task` deletes a branch after it is merged

### 3. Use pull requests to merge code into main

When work is complete, open a Pull Request (PR) from your branch into `main`. A PR is the place to review changes, discuss issues, and confirm everything is ready.

Important rule:
- Only project managers or mentors should approve pull requests.
- Students should contribute code, but approvals should be handled by the designated maintainers.

### 4. Basic Git commands and what they mean

```bash
git clone <repo-url>
git status
git add <file>
git add .
git commit -m "Describe your change"
git push origin <branch-name>
git log
git merge <branch-name>
git rebase <branch-name>
```

What they mean:
- `git clone` copies a repository from GitHub to your local machine
- `git status` shows which files changed and what branch you are on
- `git add` stages files for commit
- `git commit` saves staged changes with a message
- `git push` uploads your local commits to GitHub
- `git log` shows recent commit history
- `git merge` combines another branch into your current branch
- `git rebase` reapplies your commits on top of another branch and can help keep history cleaner

### 5. Recommended team habits

- Pull the latest changes before starting work
- Keep commits small and descriptive
- Avoid committing large data files or secrets
- Open a PR early for feedback, not only at the end
- Resolve merge conflicts carefully and communicate with the team

### 6. Example workflow

```bash
git checkout main
git pull origin main
git checkout -b feature/data-cleaning
git status
git add .
git commit -m "Add initial data cleaning script"
git push origin feature/data-cleaning
```

Then open a Pull Request on GitHub and wait for approval from the appropriate project manager or mentor.

## Notes for DS3 projects

This template is intentionally simple so students can focus on the science instead of setup. As projects grow, teams can add:

- experiment tracking
- model checkpoints
- deployment scripts
- cloud infrastructure (AWS/GCP) in `infra/`
- frontend UI/UX code in `frontend/`
- CI checks
- docs pages
