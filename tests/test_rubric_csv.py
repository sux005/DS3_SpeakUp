"""Checks for calculator-ready modular rubric definitions."""

from __future__ import annotations

import csv

import pytest

from src.scoring import score_transcribe_items
from src.scoring.rubric_definition import (
    DEFAULT_RUBRIC_PATH,
    REQUIRED_COLUMNS,
    load_rubric,
)


def test_default_rubric_has_only_runtime_columns():
    with DEFAULT_RUBRIC_PATH.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)

    assert tuple(reader.fieldnames or ()) == REQUIRED_COLUMNS
    assert len(rows) == 19
    assert {row["rubric_version"] for row in rows} == {"2026-10-31"}
    assert {row["minimum_speaking_seconds"] for row in rows} == {"60"}
    assert {row["metric"] for row in rows} == {
        "speaking_rate",
        "filler_words",
        "pauses_inside_sentences",
    }


def test_default_rubric_boundaries_match_finalized_scores():
    rubric = load_rubric()
    speaking_expected = {
        89: 0, 90: 1, 104: 1, 105: 2, 119: 2, 120: 3, 134: 3,
        135: 4, 155: 4, 156: 3, 170: 3, 171: 2, 185: 2,
        186: 1, 200: 1, 201: 0,
    }
    filler_expected = {1.99: 4, 2: 3, 3.5: 2, 5.5: 1, 8: 0}
    pause_expected = {8.99: 4, 9: 3, 12: 2, 15: 1, 18: 0}

    assert {
        value: rubric.score("speaking_rate", value) for value in speaking_expected
    } == speaking_expected
    assert {
        value: rubric.score("filler_words", value) for value in filler_expected
    } == filler_expected
    assert {
        value: rubric.score("pauses_inside_sentences", value)
        for value in pause_expected
    } == pause_expected


def test_new_rubric_can_be_loaded_without_calculator_changes(tmp_path):
    path = tmp_path / "custom.csv"
    path.write_text(
        "rubric_version,minimum_speaking_seconds,metric,score,min_value,"
        "min_inclusive,max_value,max_inclusive\n"
        "custom-v1,30,speaking_rate,2,,,,\n"
        "custom-v1,30,filler_words,3,,,,\n"
        "custom-v1,30,pauses_inside_sentences,4,,,,\n",
        encoding="utf-8",
    )

    rubric = load_rubric(path)

    assert rubric.version == "custom-v1"
    assert rubric.minimum_speaking_seconds == 30
    assert rubric.score("speaking_rate", 500) == 2
    assert rubric.score("filler_words", 0) == 3

    items = [
        {
            "type": "pronunciation",
            "start_time": str(index),
            "end_time": str(index + 1),
            "alternatives": [{"content": "word"}],
        }
        for index in range(30)
    ]
    result = score_transcribe_items(items, rubric)
    assert result["rubric_version"] == "custom-v1"
    assert result["rubric_scores"] == {
        "speaking_rate": 2,
        "filler_words": 3,
        "pauses_inside_sentences": 4,
    }


def test_missing_or_overlapping_band_fails_when_scored(tmp_path):
    path = tmp_path / "invalid.csv"
    path.write_text(
        "rubric_version,minimum_speaking_seconds,metric,score,min_value,"
        "min_inclusive,max_value,max_inclusive\n"
        "invalid,60,speaking_rate,1,,,100,true\n"
        "invalid,60,speaking_rate,2,50,true,,\n",
        encoding="utf-8",
    )
    rubric = load_rubric(path)

    with pytest.raises(ValueError, match="2 matching bands"):
        rubric.score("speaking_rate", 75)
    with pytest.raises(ValueError, match="0 matching bands"):
        rubric.score("filler_words", 1)
