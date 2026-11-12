# macOS development setup

SpeakUp's Python application code is cross-platform. The deployed audio worker
still runs as a Linux `amd64` Lambda container, while local development and
model-backed audio QA support both Apple Silicon and Intel Macs.

## Supported local paths

| Work | Python | Requirements |
| --- | --- | --- |
| API, storage, scoring, packaging, and unit tests | Python 3.13 | `requirements-dev.txt` |
| DeepFilterNet audio preparation and real-audio QA | Python 3.11 | `requirements-audio-model.txt` |
| Optional local Faster Whisper transcription | Compatible active environment | `requirements-transcription.txt` |

DeepFilterNet 0.5.6 provides CPython 3.11 wheels for both Apple Silicon and
Intel macOS. PyTorch's macOS wheels use plain version numbers rather than the
Linux/Windows `+cpu` suffix; the repository requirements select the correct
form with environment markers.

## Prerequisites

Install Apple's command-line developer tools, Homebrew, Python, Git, and the
AWS CLI as needed for your role:

```bash
xcode-select --install
brew install python@3.13 python@3.11 git awscli
```

Docker Desktop is needed only to build or inspect the Linux Lambda container.
FFmpeg is optional because PyAV wheels include their decoding libraries, but it
is useful for command-line playback and as a decoder fallback:

```bash
brew install ffmpeg
```

## Standard development environment

From the repository root:

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
cp .env.development.example .env.development
python -m pytest -q --basetemp .test-tmp -p no:cacheprovider
```

The ordinary unit suite does not require DeepFilterNet, PyTorch, FFmpeg, private
recordings, or live AWS credentials.

## Model-backed audio environment

Keep native model dependencies isolated from the Python 3.13 development
environment:

```bash
deactivate 2>/dev/null || true
python3.11 -m venv .venv-audio-v2
source .venv-audio-v2/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements-audio-model.txt
```

Verify the critical native packages:

```bash
python -c "import platform, torch, torchaudio; import deepfilterlib; print(platform.machine(), torch.__version__, torchaudio.__version__)"
```

Run audio preparation:

```bash
python -m src.audio.preprocess path/to/recording.m4a results/prepared
```

Run the six-clip QA set when the private source recordings are present:

```bash
python scripts/run_real_audio_qa.py
```

The default backend is DeepFilterNet. The legacy RNNoise compatibility backend
is optional and is not used by the deployed pipeline. Its pinned wheel supports
macOS 15 and newer:

```bash
python -m pip install -r requirements-rnnoise.txt
```

Do not install this optional file on older macOS versions; keep
`AUDIO_ENHANCEMENT_BACKEND=deepfilternet` or use `none` for tests that inject a
fake enhancer.

## Local transcription

In the intended local environment:

```bash
python -m pip install -r requirements-transcription.txt
python scripts/transcribe_local.py
```

The Faster Whisper model downloads into the ignored `models/` directory the
first time it runs.

## Building the Lambda packages

The ZIP-based Lambdas can be packaged directly on macOS because the build script
copies Python source instead of installing platform-specific wheels:

```bash
python scripts/build_lambda_packages.py
```

The audio-prep Lambda is a Linux container. On either Intel or Apple Silicon
Mac, build the production architecture explicitly:

```bash
docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  -f infra/lambda/audio_prep/Dockerfile \
  -t speakup-audio-prep:local \
  --load .
```

Building `linux/amd64` on Apple Silicon uses Docker's architecture emulation and
can be slower than a native build. Do not change the platform to `linux/arm64`
without also changing and validating the Lambda architecture in CloudFormation.

## AWS access

Use the same short-lived AWS profile as other platforms:

```bash
aws login --profile speakup-dev
aws sts get-caller-identity --profile speakup-dev
aws configure get region --profile speakup-dev
```

The selected Region must be `us-east-2`. Never put AWS access keys in an env
file or commit `.env.development`.

## Common macOS failures

### No matching distribution for `torch==2.5.1+cpu`

Pull the current branch and confirm `requirements-audio-model.txt` contains the
`sys_platform == "darwin"` entries. macOS uses `torch==2.5.1`, not the
`+cpu` package version.

### No matching distribution for `deepfilterlib`

Confirm the model environment is CPython 3.11 and that the terminal is running
natively for the Mac architecture:

```bash
python --version
python -c "import platform; print(platform.machine())"
```

### `python3.11` or `python3.13` is not found

Install the version with Homebrew, then open a new shell:

```bash
brew install python@3.11 python@3.13
```

### Audio container build fails on Apple Silicon

Confirm Docker Desktop is running and the command includes
`--platform linux/amd64`. The production image is intentionally built for the
Lambda architecture rather than the host Mac architecture.
