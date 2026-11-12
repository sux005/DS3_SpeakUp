"""Transcribe raw and noise-cancelled audio with one local Whisper model."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.compare_noise_cancellation import compare
from src.transcription.local import transcribe_file


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw_audio", type=Path)
    parser.add_argument("noise_cancelled_audio", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model", default="small.en")
    parser.add_argument("--language", default="en")
    parser.add_argument("--reference-text", type=Path)
    args = parser.parse_args()
    for audio in (args.raw_audio, args.noise_cancelled_audio):
        if not audio.is_file():
            parser.error(f"Audio file does not exist: {audio}")

    from faster_whisper import WhisperModel

    model = WhisperModel(
        args.model,
        device="cpu",
        compute_type="int8",
        download_root=str(PROJECT_ROOT / "models" / "faster-whisper"),
    )
    raw = transcribe_file(
        args.raw_audio,
        args.output_dir / "raw-whisper.json",
        model,
        args.model,
        args.language,
    )
    enhanced = transcribe_file(
        args.noise_cancelled_audio,
        args.output_dir / "noise-cancelled-whisper.json",
        model,
        args.model,
        args.language,
    )
    reference = (
        args.reference_text.read_text(encoding="utf-8").strip()
        if args.reference_text
        else None
    )
    report = compare(
        raw["full_text"],
        enhanced["full_text"],
        raw_metadata=raw,
        enhanced_metadata=enhanced,
        reviewed_reference=reference,
    )
    report.update(
        {
            "engine": "faster-whisper",
            "model": args.model,
            "raw_audio": str(args.raw_audio.resolve()),
            "noise_cancelled_audio": str(args.noise_cancelled_audio.resolve()),
        }
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output = args.output_dir / "comparison.json"
    output.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2, sort_keys=True))
    print(f"Comparison: {output.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
