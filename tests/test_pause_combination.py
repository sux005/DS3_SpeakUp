from src.scoring import score_transcribe_items
from src.scoring.pauses import combine, gaps_between, merge


def word_items(spans, sentence_end_after=()):
    items = []
    for index, (start, end) in enumerate(spans):
        items.append({"type": "pronunciation", "start_time": str(start), "end_time": str(end),
                      "alternatives": [{"content": "word"}]})
        if index in sentence_end_after:
            items.append({"type": "punctuation", "alternatives": [{"content": "."}]})
    return items


def test_gaps_between_spans():
    assert gaps_between([(1, 2), (3, 4)], 5) == [(0.0, 1), (2, 3), (4, 5)]


def test_merge_joins_a_pause_split_by_a_click():
    words = [(0.0, 1.0), (2.0, 3.0)]
    assert merge([(1.0, 1.4), (1.5, 1.9)], words) == [(1.0, 1.9)]
    assert merge([(1.0, 1.4), (2.5, 2.9)], words) == [(1.0, 1.4), (2.5, 2.9)]


def test_combine_adds_noisy_pause_only_when_silero_and_word_gap_agree():
    words = [(0.0, 1.0), (2.0, 3.0), (4.0, 5.0)]
    energy = [(1.0, 1.5)]                       # quiet pause after word 1
    silero = [(0.0, 1.0), (2.0, 3.0), (4.0, 5.0)]  # no speech in both word gaps
    assert combine(energy, words, silero) == [(1.0, 1.5), (3.0, 4.0)]
    assert combine(energy, words, None) == [(1.0, 1.5)]


def test_scorer_uses_acoustic_pauses_and_punctuation():
    items = word_items([(0, 1), (2, 3), (4, 5)], sentence_end_after={1})
    acoustic = {"energy_silences": [(1.0, 1.6)], "silero_speech": [(0, 1), (2, 3), (4, 5)], "duration_seconds": 5}
    result = score_transcribe_items(items, acoustic=acoustic)
    assert result["pause_detection_method"] == "energy_or_silero_and_word_gap"
    assert result["pauses_inside_sentences"] == 1      # after word 1, no period
    assert result["pauses_between_sentences"] == 1     # after word 2, period
    assert score_transcribe_items(items)["pause_detection_method"] == "transcribe_word_gaps"


def test_without_acoustic_input_pauses_are_word_gaps_as_before():
    items = word_items([(0, 1), (1.5, 2), (2.1, 3)], sentence_end_after={0})
    result = score_transcribe_items(items)
    assert result["pause_detection_method"] == "transcribe_word_gaps"
    assert (result["pauses_between_sentences"], result["pauses_inside_sentences"]) == (1, 0)
