"""Boundary and integration checks for the finalized speaking rubric."""

from __future__ import annotations

import pytest

from src.scoring import score_transcribe_items


def timed_words(tokens, *, seconds=60.0):
    width = seconds / len(tokens)
    return [
        {"type": "pronunciation", "start_time": str(index * width),
         "end_time": str(seconds if index == len(tokens) - 1 else (index + 1) * width),
         "alternatives": [{"content": token}]}
        for index, token in enumerate(tokens)
    ]


@pytest.mark.parametrize("count,score", [
    (89, 0), (90, 1), (104, 1), (105, 2), (119, 2),
    (120, 3), (134, 3), (135, 4), (155, 4), (156, 3),
    (170, 3), (171, 2), (185, 2), (186, 1), (200, 1), (201, 0),
])
def test_speaking_rate_score_boundaries(count, score):
    result = score_transcribe_items(timed_words(["word"] * count))
    assert result["rubric_status"] == "scored"
    assert result["words_per_minute"] == count
    assert result["rubric_scores"]["speaking_rate"] == score


def test_fillers_exclude_scored_tokens_and_preserve_watch_list():
    tokens = ["word"] * 80
    tokens[:18] = [
        "um", "uh", "er", "erm", "ah", "you", "know", "do", "you", "know",
        "like", "i", "mean", "kind", "of", "so", "well", "actually",
    ]
    result = score_transcribe_items(timed_words(tokens, seconds=80))
    assert result["filler_words"] == {
        "um": 1, "uh": 1, "er": 1, "erm": 1, "ah": 1, "you know": 1,
    }
    assert result["word_count"] == 73
    assert result["filler_count"] == 6
    assert result["watch_words"] == {
        "like": 1, "i mean": 1, "kind of": 1, "so": 1, "well": 1,
        "actually": 1,
    }
    assert result["rubric_scores"]["filler_words"] == 0


def test_excluded_you_know_contexts_are_not_counted():
    for preceding in ("do", "did", "don't", "if", "as", "would", "to"):
        tokens = ["word"] * 65
        tokens[:3] = [preceding, "you", "know"]
        result = score_transcribe_items(timed_words(tokens, seconds=65))
        assert result["filler_words"] == {}
        assert result["word_count"] == 65


@pytest.mark.parametrize("filler_count,score", [
    (1, 4), (2, 3), (4, 2), (6, 1), (8, 0),
])
def test_filler_score_bands(filler_count, score):
    tokens = ["um"] * filler_count + ["word"] * 100
    result = score_transcribe_items(timed_words(tokens, seconds=110))
    assert result["word_count"] == 100
    assert result["fillers_per_100_words"] == filler_count
    assert result["rubric_scores"]["filler_words"] == score


@pytest.mark.parametrize("pause_count,score", [
    (8, 4), (9, 3), (12, 2), (15, 1), (18, 0),
])
def test_inside_sentence_pause_score_bands(pause_count, score):
    items = timed_words(["word"] * 60)
    for index, item in enumerate(items):
        extra = min(index, pause_count) * 0.5
        item["start_time"] = str(float(item["start_time"]) + extra)
        item["end_time"] = str(float(item["end_time"]) + extra)
    result = score_transcribe_items(items)
    assert result["speaking_duration_seconds"] == 60
    assert result["pauses_inside_sentences"] == pause_count
    assert result["pauses_per_speaking_minute"] == pause_count
    assert result["rubric_scores"]["pauses_inside_sentences"] == score


def test_silence_adjacent_to_filler_is_scored_in_both_metrics():
    items = timed_words(["um"] + ["word"] * 60, seconds=61)
    for item in items[1:]:
        item["start_time"] = str(float(item["start_time"]) + 0.5)
        item["end_time"] = str(float(item["end_time"]) + 0.5)
    result = score_transcribe_items(items)
    assert result["filler_count"] == 1
    assert result["pauses_inside_sentences"] == 1
    assert result["speaking_duration_seconds"] == 61


def test_pauses_use_speaking_time_and_sentence_boundaries():
    items = timed_words(["word"] * 65, seconds=65)
    for index, item in enumerate(items):
        extra = 0 if index <= 10 else 1.2 if index <= 20 else 4.4
        item["start_time"] = str(float(item["start_time"]) + extra)
        item["end_time"] = str(float(item["end_time"]) + extra)
    items.insert(21, {"type": "punctuation", "alternatives": [{"content": "."}]})
    result = score_transcribe_items(items)
    assert result["rubric_status"] == "scored"
    assert result["duration_seconds"] == 69.4
    assert result["speaking_duration_seconds"] == 65
    assert result["total_pause_seconds"] == 4.4
    assert result["pauses_inside_sentences"] == 1
    assert result["pauses_between_sentences"] == 1
    assert result["pauses_per_speaking_minute"] == 0.92
    assert result["long_pauses"] == [
        {"start_seconds": 11.0, "end_seconds": 12.2,
         "duration_seconds": 1.2, "inside_sentence": True},
        {"start_seconds": 22.2, "end_seconds": 25.4,
         "duration_seconds": 3.2, "inside_sentence": False},
    ]


def test_speech_minimum_uses_time_after_pauses():
    items = timed_words(["word"] * 60)
    result = score_transcribe_items(items)
    assert result["rubric_status"] == "scored"
    items[-1]["end_time"] = "59.99"
    result = score_transcribe_items(items)
    assert result["rubric_status"] == "insufficient_speech"
    assert all(score is None for score in result["rubric_scores"].values())


@pytest.mark.parametrize("items", [
    [{"type": "pronunciation", "end_time": "1", "alternatives": [{"content": "word"}]}],
    [{"type": "pronunciation", "start_time": "0", "end_time": "nan",
      "alternatives": [{"content": "word"}]}],
])
def test_invalid_word_timing_fails_closed(items):
    with pytest.raises(ValueError, match="timing"):
        score_transcribe_items(items)
