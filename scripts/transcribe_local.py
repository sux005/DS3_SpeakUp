"""Transcribe the private SpeakUp clips into timestamped local JSON files."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.run_real_audio_qa import CLIP_NAMES
from src.transcription.local import transcribe_file


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=PROJECT_ROOT / "data" / "raw")
    parser.add_argument(
        "--output-dir", type=Path, default=PROJECT_ROOT / "results" / "local_transcripts"
    )
    parser.add_argument("--model", default="small.en")
    parser.add_argument("--language", default="en")
    parser.add_argument("--clip", choices=CLIP_NAMES, help="Transcribe only one clip")
    args = parser.parse_args()

    names = (args.clip,) if args.clip else CLIP_NAMES
    missing = [name for name in names if not (args.input_dir / name).is_file()]
    if missing:
        parser.error(f"Missing raw clips in {args.input_dir}: {', '.join(missing)}")

    from faster_whisper import WhisperModel

    model = WhisperModel(
        args.model,
        device="cpu",
        compute_type="int8",
        download_root=str(PROJECT_ROOT / "models" / "faster-whisper"),
    )
    for name in names:
        source = args.input_dir / name
        output = args.output_dir / source.stem / "transcript.json"
        transcript = transcribe_file(source, output, model, args.model, args.language)
        print(f"{name}: {len(transcript['segments'])} segments -> {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
