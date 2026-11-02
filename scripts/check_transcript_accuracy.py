"""Compare an automatic transcript with a human-reviewed reference transcript."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys


def words(text: str) -> list[str]:
    return re.findall(r"\w+", text.casefold())


def word_error_rate(reference: str, hypothesis: str) -> float:
    expected = words(reference)
    actual = words(hypothesis)
    if not expected:
        raise ValueError("The reviewed reference transcript is empty")
    previous = list(range(len(actual) + 1))
    for row, reference_word in enumerate(expected, start=1):
        current = [row]
        for column, hypothesis_word in enumerate(actual, start=1):
            current.append(
                min(
                    previous[column] + 1,
                    current[column - 1] + 1,
                    previous[column - 1] + (reference_word != hypothesis_word),
                )
            )
        previous = current
    return previous[-1] / len(expected)


def compare(transcript_path: Path, reference_path: Path) -> dict[str, object]:
    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    reference = json.loads(reference_path.read_text(encoding="utf-8"))
    if transcript["source"]["sha256"] != reference["source_sha256"]:
        raise ValueError("Reference and automatic transcript have different source hashes")
    if reference.get("review_status") != "reviewed":
        raise ValueError("Reference transcript has not been marked reviewed")
    return {
        "source_file": transcript["source"]["file"],
        "reference_words": len(words(reference["text"])),
        "hypothesis_words": len(words(transcript["full_text"])),
        "word_error_rate": round(word_error_rate(reference["text"], transcript["full_text"]), 4),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("transcript", type=Path)
    parser.add_argument("reference", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(compare(args.transcript, args.reference), indent=2))
    except (OSError, ValueError, KeyError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    sys.exit(main())
