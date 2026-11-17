"""Pause detection chosen 2026-11-09: energy 0.3 s OR (Silero no-speech AND a transcript word gap).

The quiet parts come from a loudness (energy) detector. An energy silence is kept whole when it
overlaps a transcript word gap or contains a word edge, because Transcribe often stretches a word's
timing over a real silence (Link 14: 42 energy pauses, only 16 survived the old clip-to-word-gap
step). Silences that sit fully inside one word, with no gap and no edge, are dropped.
Pauses filled with laughter, clapping or breathing are not quiet, so a second check adds any
stretch where Silero hears no speech AND the
transcript has a word gap. Silences the detector split in two (for example by a tongue click) are
merged back when they are under 0.3 s apart with no word between them.

Blind hand-marked results: Link 15 (TED) 20 of 21 pauses, Link 16 (student speech) 19 of 20.
Everything here is plain Python on (start, end) seconds. The energy and Silero inputs come from
audio (src/audio/pause_detection.py, run in the audio-prep step). Without them the rubric keeps using
Transcribe word gaps, exactly as before.
"""

from __future__ import annotations

from typing import Iterable, Sequence

Interval = tuple[float, float]
MINIMUM_PAUSE_SECONDS = 0.3
MERGE_GAP_SECONDS = 0.3


def longer_than(intervals: Iterable[Interval], minimum: float = MINIMUM_PAUSE_SECONDS) -> list[Interval]:
    return [(start, end) for start, end in intervals if end - start >= minimum - 1e-9]


def gaps_between(spans: Iterable[Interval], total: float | None = None) -> list[Interval]:
    """The uncovered stretches between sorted spans (and after the last one when total is given)."""

    out: list[Interval] = []
    previous = 0.0
    for start, end in sorted(spans):
        if start > previous:
            out.append((previous, start))
        previous = max(previous, end)
    if total is not None and total > previous:
        out.append((previous, total))
    return out


def intersect(first: Sequence[Interval], second: Sequence[Interval]) -> list[Interval]:
    out = []
    for start_a, end_a in first:
        for start_b, end_b in second:
            start, end = max(start_a, start_b), min(end_a, end_b)
            if end > start:
                out.append((start, end))
    return sorted(out)


def _touches_word_boundary(silence: Interval, word_spans: Sequence[Interval],
                           word_gaps: Sequence[Interval]) -> bool:
    """True when the silence overlaps a word gap or a word starts or ends inside it."""

    start, end = silence
    return (any(start < gap_end and end > gap_start for gap_start, gap_end in word_gaps)
            or any(start < edge < end for span in word_spans for edge in span))


def combine(energy_silences: Sequence[Interval], word_spans: Sequence[Interval],
            silero_speech: Sequence[Interval] | None, total_seconds: float | None = None) -> list[Interval]:
    """Energy pauses, plus Silero-and-word-gap pauses that energy missed, merged."""

    word_gaps = gaps_between(word_spans, total_seconds)
    pauses = longer_than([silence for silence in energy_silences
                          if _touches_word_boundary(silence, word_spans, word_gaps)])
    if silero_speech is not None:
        silero_gaps = gaps_between(silero_speech, total_seconds)
        for extra in longer_than(intersect(silero_gaps, word_gaps)):
            if not any(start < extra[1] and end > extra[0] for start, end in pauses):
                pauses.append(extra)
    return merge(sorted(pauses), word_spans)


def merge(pauses: Sequence[Interval], word_spans: Sequence[Interval],
          gap: float = MERGE_GAP_SECONDS) -> list[Interval]:
    """Join pauses under ``gap`` apart when no word starts between them."""

    out: list[Interval] = []
    for start, end in sorted(pauses):
        if out and start - out[-1][1] < gap and not any(out[-1][1] <= ws < start for ws, _ in word_spans):
            out[-1] = (out[-1][0], max(out[-1][1], end))
        else:
            out.append((start, end))
    return out
