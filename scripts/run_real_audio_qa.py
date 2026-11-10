"""Prepare the private raw clips and keep inspectable QA artifacts locally."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.audio.config import AudioPrepConfig


CLIP_NAMES = tuple(f"SPEAKUP {number}.mp4" for number in range(1, 7))
REQUIRED_ARTIFACTS = (
    "reference.wav",
    "enhanced_model.wav",
    "enhanced_blended.wav",
    "diagnostic.wav",
    "enhanced.wav",
    "report.json",
)


def source_sha256(source: Path) -> str:
    """Hash the exact source bytes without loading the entire file into memory."""
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def has_matching_output(
    source: Path, output: Path, checksum: str, config: AudioPrepConfig
) -> bool:
    """Reuse only a complete output for these bytes and this pipeline configuration."""
    if not all(
        (output / name).is_file() and (output / name).stat().st_size > 0
        for name in REQUIRED_ARTIFACTS
    ):
        return False
    try:
        report = json.loads((output / "report.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return (
        isinstance(report, dict)
        and report.get("pipeline_version") == config.pipeline_version
        and report.get("config_fingerprint") == config.fingerprint()
        and isinstance(report.get("source"), dict)
        and report["source"].get("source_sha256") == checksum
        and report["source"].get("source_file") == source.name
    )


def process_clip(source: Path, output_directory: Path, config: AudioPrepConfig):
    """Generate artifacts whose report identifies the exact raw input bytes."""
    from src.audio.preprocess import process_audio_file

    source_hash = source_sha256(source)
    return process_audio_file(
        source,
        output_directory,
        config,
        source_metadata={
            "source_file": source.name,
            "source_sha256": source_hash,
        },
    )


def run_batch(
    input_dir: Path,
    output_dir: Path,
    config: AudioPrepConfig,
    names: tuple[str, ...] = CLIP_NAMES,
) -> list[tuple[str, str]]:
    """Skip identical sources in this batch and reuse complete matching outputs."""
    seen: dict[str, str] = {}
    results: list[tuple[str, str]] = []
    for name in names:
        source = input_dir / name
        checksum = source_sha256(source)
        if checksum in seen:
            results.append((name, f"duplicate of {seen[checksum]}"))
            continue
        output = output_dir / source.stem
        if has_matching_output(source, output, checksum, config):
            results.append((name, "already processed"))
        else:
            artifacts = process_clip(source, output, config)
            results.append((name, str(artifacts["report"])))
        seen[checksum] = name
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir", type=Path, default=PROJECT_ROOT / "data" / "raw"
    )
    parser.add_argument(
        "--output-dir", type=Path, default=PROJECT_ROOT / "results" / "real_audio_qa"
    )
    parser.add_argument(
        "--enhancement-backend",
        choices=("deepfilternet", "rnnoise", "none"),
        default="deepfilternet",
    )
    args = parser.parse_args()

    missing = [name for name in CLIP_NAMES if not (args.input_dir / name).is_file()]
    if missing:
        parser.error(f"Missing raw clips in {args.input_dir}: {', '.join(missing)}")

    config = AudioPrepConfig(enhancement_backend=args.enhancement_backend)
    for name, outcome in run_batch(args.input_dir, args.output_dir, config):
        print(f"{name}: {outcome}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
