"""CLI-level checks for WPM and filler metrics across transcript formats."""

from __future__ import annotations

import json

import pytest

from scripts.calculate_wpm import calculate_wpm
from scripts.count_fillers import count_fillers
from src.scoring import extract_timed_items


def timed_words(tokens: list[str], seconds: float) -> list[dict[str, object]]:
    """Create deterministic Amazon Transcribe-style timed words."""

    width = seconds / len(tokens)
    return [
        {
            "type": "pronunciation",
            "start_time": str(index * width),
            "end_time": str((index + 1) * width),
            "alternatives": [{"content": token}],
        }
        for index, token in enumerate(tokens)
    ]


def test_metric_scripts_read_raw_transcribe_json(tmp_path):
    path = tmp_path / "transcript.json"
    path.write_text(
        json.dumps({"results": {"items": timed_words(["word"] * 60, 60)}}),
        encoding="utf-8",
    )

    wpm = calculate_wpm(path)
    fillers = count_fillers(path)

    assert wpm["words_per_minute"] == 60
    assert wpm["speaking_rate_score"] == 0
    assert fillers["filler_count"] == 0
    assert fillers["filler_score"] == 4


def test_filler_script_uses_shared_rubric_rules(tmp_path):
    path = tmp_path / "transcript.json"
    tokens = ["um", "you", "know", "like"] + ["word"] * 60
    path.write_text(
        json.dumps({"data": {"items": timed_words(tokens, 64)}}),
        encoding="utf-8",
    )

    result = count_fillers(path)

    assert result["word_count"] == 61
    assert result["filler_words"] == {"um": 1, "you know": 1}
    assert result["watch_words"] == {"like": 1}
    assert result["filler_count"] == 2


def test_local_transcript_words_are_adapted():
    document = {
        "segments": [
            {
                "words": [
                    {"start": 0, "end": 0.5, "text": "Um"},
                    {"start": 0.5, "end": 1.0, "text": "hello."},
                ]
            }
        ]
    }

    items = extract_timed_items(document)

    assert items[0]["alternatives"] == [{"content": "Um"}]
    assert items[1]["end_time"] == 1.0


def test_unknown_transcript_shape_is_rejected():
    with pytest.raises(ValueError, match="Expected Amazon Transcribe"):
        extract_timed_items({"text": "untimed text is not sufficient for WPM"})
