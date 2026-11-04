"""Calculate SpeakUp words per minute from a timestamped transcript JSON file."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from src.scoring import extract_timed_items, score_transcribe_items


def calculate_wpm(path: Path) -> dict[str, Any]:
    """Load one supported transcript file and return speaking-rate metrics."""

    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("Transcript JSON must be an object")
    metrics = score_transcribe_items(extract_timed_items(document))
    return {
        "source": str(path),
        "rubric_version": metrics["rubric_version"],
        "rubric_status": metrics["rubric_status"],
        "word_count": metrics["word_count"],
        "duration_seconds": metrics["duration_seconds"],
        "speaking_duration_seconds": metrics["speaking_duration_seconds"],
        "words_per_minute": metrics["words_per_minute"],
        "speaking_rate_score": metrics["rubric_scores"]["speaking_rate"],
    }


def main() -> int:
    """Run the command-line WPM calculator."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("transcript", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(calculate_wpm(args.transcript), indent=2))
    except (OSError, json.JSONDecodeError, ValueError, KeyError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    sys.exit(main())
