"""Tests for raw-versus-noise-cancelled transcript comparison."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.compare_noise_cancellation import compare, load_transcript


def test_comparison_refuses_to_guess_winner_without_reviewed_text() -> None:
    result = compare("we like ice cream", "we really like ice cream")

    assert result["comparison"]["word_edit_distance"] == 1
    assert result["accuracy"]["winner"] is None
    assert result["accuracy"]["reviewed_reference_supplied"] is False


def test_comparison_selects_lower_wer_with_reviewed_text() -> None:
    result = compare(
        "we light ice cream",
        "we really like ice cream",
        reviewed_reference="we really like ice cream",
    )

    assert result["accuracy"]["raw_word_error_rate"] == pytest.approx(0.4)
    assert result["accuracy"]["noise_cancelled_word_error_rate"] == 0
    assert result["accuracy"]["winner"] == "noise_cancelled"


def test_loads_local_and_transcribe_json_and_confidence(tmp_path: Path) -> None:
    local = tmp_path / "local.json"
    local.write_text(
        json.dumps(
            {
                "full_text": "Hello world",
                "segments": [
                    {
                        "words": [
                            {"text": "Hello", "probability": 0.8},
                            {"text": "world", "probability": 1.0},
                        ]
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    transcribe = tmp_path / "transcribe.json"
    transcribe.write_text(
        json.dumps(
            {
                "results": {
                    "transcripts": [{"transcript": "Hello world"}],
                    "items": [
                        {
                            "type": "pronunciation",
                            "alternatives": [{"content": "Hello", "confidence": "0.7"}],
                        },
                        {"type": "punctuation", "alternatives": [{"content": "."}]},
                    ],
                }
            }
        ),
        encoding="utf-8",
    )

    local_text, local_json = load_transcript(local)
    remote_text, remote_json = load_transcript(transcribe)
    result = compare(
        local_text,
        remote_text,
        raw_metadata=local_json,
        enhanced_metadata=remote_json,
    )

    assert result["raw"]["mean_word_confidence"] == pytest.approx(0.9)
    assert result["noise_cancelled"]["mean_word_confidence"] == pytest.approx(0.7)
