"""Prepare the private raw clips and keep inspectable QA artifacts locally."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.audio.config import AudioPrepConfig
from src.audio.preprocess import process_audio_file


CLIP_NAMES = tuple(f"SPEAKUP {number}.mp4" for number in range(1, 7))


def process_clip(source: Path, output_directory: Path, config: AudioPrepConfig):
    """Generate artifacts whose report identifies the exact raw input bytes."""

    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    return process_audio_file(
        source,
        output_directory,
        config,
        source_metadata={
            "source_file": source.name,
            "source_sha256": source_hash,
        },
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir", type=Path, default=PROJECT_ROOT / "data" / "raw"
    )
    parser.add_argument(
        "--output-dir", type=Path, default=PROJECT_ROOT / "results" / "real_audio_qa"
    )
    parser.add_argument(
        "--enhancement-backend", choices=("rnnoise", "none"), default="rnnoise"
    )
    args = parser.parse_args()

    missing = [name for name in CLIP_NAMES if not (args.input_dir / name).is_file()]
    if missing:
        parser.error(f"Missing raw clips in {args.input_dir}: {', '.join(missing)}")

    config = AudioPrepConfig(enhancement_backend=args.enhancement_backend)
    for name in CLIP_NAMES:
        source = args.input_dir / name
        output = args.output_dir / source.stem
        artifacts = process_clip(source, output, config)
        print(f"{name}: {artifacts['report']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
