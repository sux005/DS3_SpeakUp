"""Compare raw and noise-cancelled ASR transcripts without guessing accuracy.

The input may be SpeakUp local Whisper JSON, an Amazon Transcribe response,
an API transcript artifact, or a plain-text transcript. A reviewed plain-text
reference is optional; without one, the report deliberately does not declare a
winner.
"""

from __future__ import annotations

import argparse
from difflib import SequenceMatcher
import json
from pathlib import Path
import re
import sys
from typing import Any


def words(text: str) -> list[str]:
    """Return normalized word tokens for engine-independent comparisons."""

    return re.findall(r"\w+(?:['’-]\w+)*", text.casefold())


def edit_distance(expected: list[str], actual: list[str]) -> int:
    """Return the Levenshtein edit distance between two token sequences."""

    previous = list(range(len(actual) + 1))
    for row, expected_word in enumerate(expected, start=1):
        current = [row]
        for column, actual_word in enumerate(actual, start=1):
            current.append(
                min(
                    previous[column] + 1,
                    current[column - 1] + 1,
                    previous[column - 1] + (expected_word != actual_word),
                )
            )
        previous = current
    return previous[-1]


def word_error_rate(reference: str, hypothesis: str) -> float:
    """Return WER for a non-empty human-reviewed reference transcript."""

    expected = words(reference)
    if not expected:
        raise ValueError("The reviewed reference transcript is empty")
    return edit_distance(expected, words(hypothesis)) / len(expected)


def _text_from_json(value: Any) -> str:
    if not isinstance(value, dict):
        raise ValueError("Transcript JSON must contain an object")
    for key in ("full_text", "text", "transcript"):
        if isinstance(value.get(key), str):
            return value[key]
    data = value.get("data")
    if isinstance(data, dict):
        return _text_from_json(data)
    results = value.get("results")
    if isinstance(results, dict):
        transcripts = results.get("transcripts")
        if isinstance(transcripts, list) and transcripts:
            first = transcripts[0]
            if isinstance(first, dict) and isinstance(first.get("transcript"), str):
                return first["transcript"]
    raise ValueError("Could not find transcript text in the JSON input")


def load_transcript(path: Path) -> tuple[str, dict[str, Any] | None]:
    """Load transcript text and retain JSON metadata when available."""

    raw = path.read_text(encoding="utf-8")
    if path.suffix.casefold() != ".json":
        return raw.strip(), None
    value = json.loads(raw)
    return _text_from_json(value).strip(), value


def _confidences(value: dict[str, Any] | None) -> list[float]:
    if value is None:
        return []
    local: list[float] = []
    for segment in value.get("segments", []):
        if not isinstance(segment, dict):
            continue
        for word in segment.get("words", []):
            if isinstance(word, dict) and isinstance(word.get("probability"), (int, float)):
                local.append(float(word["probability"]))
    if local:
        return local
    results = value.get("results")
    if not isinstance(results, dict):
        return []
    remote: list[float] = []
    for item in results.get("items", []):
        if not isinstance(item, dict) or item.get("type") != "pronunciation":
            continue
        alternatives = item.get("alternatives", [])
        if not alternatives or not isinstance(alternatives[0], dict):
            continue
        try:
            remote.append(float(alternatives[0]["confidence"]))
        except (KeyError, TypeError, ValueError):
            continue
    return remote


def _summary(text: str, metadata: dict[str, Any] | None) -> dict[str, Any]:
    tokens = words(text)
    confidences = _confidences(metadata)
    return {
        "word_count": len(tokens),
        "mean_word_confidence": (
            round(sum(confidences) / len(confidences), 4) if confidences else None
        ),
        "confidence_word_count": len(confidences),
    }


def compare(
    raw_text: str,
    enhanced_text: str,
    *,
    raw_metadata: dict[str, Any] | None = None,
    enhanced_metadata: dict[str, Any] | None = None,
    reviewed_reference: str | None = None,
) -> dict[str, Any]:
    """Compare two ASR outputs and declare a winner only with reviewed truth."""

    raw_tokens = words(raw_text)
    enhanced_tokens = words(enhanced_text)
    maximum_words = max(len(raw_tokens), len(enhanced_tokens), 1)
    distance = edit_distance(raw_tokens, enhanced_tokens)
    matcher = SequenceMatcher(a=raw_tokens, b=enhanced_tokens, autojunk=False)
    result: dict[str, Any] = {
        "raw": _summary(raw_text, raw_metadata),
        "noise_cancelled": _summary(enhanced_text, enhanced_metadata),
        "comparison": {
            "word_edit_distance": distance,
            "normalized_disagreement_rate": round(distance / maximum_words, 4),
            "matching_block_ratio": round(matcher.ratio(), 4),
        },
        "accuracy": {
            "reviewed_reference_supplied": reviewed_reference is not None,
            "winner": None,
            "note": (
                "A reviewed reference is required before selecting a winner; "
                "ASR confidence alone is not an accuracy measurement."
            ),
        },
    }
    if reviewed_reference is not None:
        raw_wer = round(word_error_rate(reviewed_reference, raw_text), 4)
        enhanced_wer = round(word_error_rate(reviewed_reference, enhanced_text), 4)
        if raw_wer < enhanced_wer:
            winner = "raw"
        elif enhanced_wer < raw_wer:
            winner = "noise_cancelled"
        else:
            winner = "tie"
        result["accuracy"] = {
            "reviewed_reference_supplied": True,
            "raw_word_error_rate": raw_wer,
            "noise_cancelled_word_error_rate": enhanced_wer,
            "winner": winner,
            "note": "Winner is the condition with lower WER against reviewed text.",
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw_transcript", type=Path)
    parser.add_argument("noise_cancelled_transcript", type=Path)
    parser.add_argument("--reference-text", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        raw_text, raw_metadata = load_transcript(args.raw_transcript)
        enhanced_text, enhanced_metadata = load_transcript(
            args.noise_cancelled_transcript
        )
        reference = (
            args.reference_text.read_text(encoding="utf-8").strip()
            if args.reference_text
            else None
        )
        report = compare(
            raw_text,
            enhanced_text,
            raw_metadata=raw_metadata,
            enhanced_metadata=enhanced_metadata,
            reviewed_reference=reference,
        )
        rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered, encoding="utf-8")
        print(rendered, end="")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    sys.exit(main())
