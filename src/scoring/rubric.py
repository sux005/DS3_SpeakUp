"""The finalized 2026-10-31 speaking rubric applied to timed Transcribe words.

Word gaps estimate pauses. They do not establish acoustic silence when ASR
misses speech, so the output names this detection method explicitly.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Any, Mapping, Sequence

from src.scoring.rubric_definition import RubricDefinition, load_rubric

MINIMUM_PAUSE_SECONDS = 0.3
SCORED_SINGLE_FILLERS = frozenset({"um", "uh", "er", "erm", "ah"})
YOU_KNOW_EXCLUSIONS = frozenset({"do", "did", "don't", "if", "as", "would", "to"})
WATCH_SINGLE = frozenset({
    "like", "so", "well", "actually", "basically", "right", "okay", "hmm",
})
WATCH_PAIRS = frozenset({("i", "mean"), ("kind", "of"), ("sort", "of")})
TOKEN_EDGES = re.compile(r"^[^\w']+|[^\w']+$")


@dataclass(frozen=True)
class _Word:
    start: float
    end: float
    token: str
    sentence_end: bool


def _token(content: Any) -> str:
    return TOKEN_EDGES.sub("", str(content).casefold().replace("’", "'"))


def _words(items: Sequence[Mapping[str, Any]]) -> list[_Word]:
    words: list[_Word] = []
    for item in items:
        if item.get("type") == "punctuation":
            alternatives = item.get("alternatives") or []
            content = alternatives[0].get("content", "") if alternatives else ""
            if words and any(mark in str(content) for mark in ".?!"):
                previous = words[-1]
                words[-1] = _Word(previous.start, previous.end, previous.token, True)
            continue
        if item.get("type") != "pronunciation":
            continue
        try:
            start = float(item["start_time"])
            end = float(item["end_time"])
            content = item["alternatives"][0]["content"]
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise ValueError("Transcribe pronunciation is missing valid timing or text") from error
        token = _token(content)
        if not token or not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
            raise ValueError("Transcribe pronunciation has invalid timing or text")
        if words and start < words[-1].start:
            raise ValueError("Transcribe pronunciations are out of time order")
        words.append(_Word(start, end, token, any(mark in str(content) for mark in ".?!")))
    return words


def _fillers(
    words: Sequence[_Word],
) -> tuple[dict[str, int], dict[str, int], int, list[dict[str, Any]]]:
    scored: dict[str, int] = {}
    watch: dict[str, int] = {}
    excluded: set[int] = set()
    occurrences: list[dict[str, Any]] = []
    for index, word in enumerate(words):
        if word.token in SCORED_SINGLE_FILLERS:
            scored[word.token] = scored.get(word.token, 0) + 1
            excluded.add(index)
            occurrences.append({
                "filler": word.token,
                "start_seconds": round(word.start, 3),
                "end_seconds": round(word.end, 3),
            })
        if (
            word.token == "you" and index + 1 < len(words)
            and words[index + 1].token == "know" and not word.sentence_end
            and not (
                index > 0 and not words[index - 1].sentence_end
                and words[index - 1].token in YOU_KNOW_EXCLUSIONS
            )
        ):
            scored["you know"] = scored.get("you know", 0) + 1
            excluded.update((index, index + 1))
            occurrences.append({
                "filler": "you know",
                "start_seconds": round(word.start, 3),
                "end_seconds": round(words[index + 1].end, 3),
            })
        if word.token in WATCH_SINGLE:
            watch[word.token] = watch.get(word.token, 0) + 1
        if index + 1 < len(words) and not word.sentence_end:
            pair = (word.token, words[index + 1].token)
            if pair in WATCH_PAIRS:
                label = " ".join(pair)
                watch[label] = watch.get(label, 0) + 1
    return scored, watch, len(words) - len(excluded), occurrences


def score_transcribe_items(
    items: Sequence[Mapping[str, Any]],
    rubric: RubricDefinition | None = None,
) -> dict[str, Any]:
    """Measure and score timed words without inventing scores for short speech."""

    active_rubric = rubric or load_rubric()
    words = _words(items)
    fillers, watch, spoken_count, filler_occurrences = _fillers(words)
    first_start = words[0].start if words else 0.0
    last_end = words[-1].end if words else 0.0
    duration = max(0.0, last_end - first_start)
    pauses: list[dict[str, Any]] = []
    long_pauses: list[dict[str, Any]] = []
    total_pause = 0.0
    for left, right in zip(words, words[1:]):
        gap = right.start - left.end
        if gap >= MINIMUM_PAUSE_SECONDS:
            pause = {
                "start_seconds": round(left.end, 2),
                "end_seconds": round(right.start, 2),
                "duration_seconds": round(gap, 2),
                "inside_sentence": not left.sentence_end,
            }
            pauses.append(pause)
            total_pause += gap
            if (pause["inside_sentence"] and gap >= 1.0) or gap >= 3.0:
                long_pauses.append(pause)
    speaking_seconds = max(0.0, duration - total_pause)
    inside_count = sum(pause["inside_sentence"] for pause in pauses)
    between_count = len(pauses) - inside_count
    wpm = spoken_count * 60 / duration if duration else 0.0
    fillers_per_100 = sum(fillers.values()) * 100 / spoken_count if spoken_count else 0.0
    pauses_per_minute = inside_count * 60 / speaking_seconds if speaking_seconds else 0.0
    eligible = (
        speaking_seconds >= active_rubric.minimum_speaking_seconds
        and spoken_count > 0
    )
    return {
        "rubric_version": active_rubric.version,
        "rubric_status": "scored" if eligible else "insufficient_speech",
        "pause_detection_method": "transcribe_word_gaps",
        "transcribed_word_count": len(words),
        "word_count": spoken_count,
        "duration_seconds": round(duration, 2),
        "speaking_duration_seconds": round(speaking_seconds, 2),
        "words_per_minute": round(wpm, 2),
        "filler_words": fillers,
        "filler_count": sum(fillers.values()),
        "filler_occurrences": filler_occurrences,
        "fillers_per_100_words": round(fillers_per_100, 2),
        "watch_words": watch,
        "pauses_inside_sentences": inside_count,
        "pauses_between_sentences": between_count,
        "pauses_per_speaking_minute": round(pauses_per_minute, 2),
        "total_pause_seconds": round(total_pause, 2),
        "pauses": pauses,
        "long_pauses": long_pauses,
        "rubric_scores": {
            "speaking_rate": (
                active_rubric.score("speaking_rate", wpm) if eligible else None
            ),
            "filler_words": (
                active_rubric.score("filler_words", fillers_per_100)
                if eligible else None
            ),
            "pauses_inside_sentences": (
                active_rubric.score("pauses_inside_sentences", pauses_per_minute)
                if eligible else None
            ),
        },
    }
