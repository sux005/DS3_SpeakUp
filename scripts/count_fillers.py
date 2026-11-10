"""Count SpeakUp scored fillers and watch words in a timed transcript JSON file."""

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


def count_fillers(path: Path) -> dict[str, Any]:
    """Load one supported transcript file and return filler-word metrics."""

    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("Transcript JSON must be an object")
    metrics = score_transcribe_items(extract_timed_items(document))
    return {
        "source": str(path),
        "rubric_version": metrics["rubric_version"],
        "rubric_status": metrics["rubric_status"],
        "word_count": metrics["word_count"],
        "filler_words": metrics["filler_words"],
        "filler_count": metrics["filler_count"],
        "fillers_per_100_words": metrics["fillers_per_100_words"],
        "watch_words": metrics["watch_words"],
        "filler_score": metrics["rubric_scores"]["filler_words"],
    }


def main() -> int:
    """Run the command-line filler counter."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("transcript", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(count_fillers(args.transcript), indent=2))
    except (OSError, json.JSONDecodeError, ValueError, KeyError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    sys.exit(main())
