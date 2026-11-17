// Complete metric objects for tests, so each test only spells out what it checks.
import type { Pause, SummaryMetrics } from "@/lib/types";

export const summaryMetrics = (overrides: Partial<SummaryMetrics> = {}): SummaryMetrics => ({
  rubric_version: "2026-10-31",
  rubric_status: "scored",
  pause_detection_method: "transcribe_word_gaps",
  transcribed_word_count: 20,
  word_count: 20,
  duration_seconds: 10,
  speaking_duration_seconds: 9,
  words_per_minute: 120,
  filler_words: {},
  filler_count: 0,
  fillers_per_100_words: 0,
  watch_words: {},
  pauses_inside_sentences: 0,
  pauses_between_sentences: 0,
  pauses_per_speaking_minute: 0,
  total_pause_seconds: 0,
  rubric_scores: { speaking_rate: 3, filler_words: 3, pauses_inside_sentences: 3 },
  ...overrides,
});

export const pause = (start_seconds: number, end_seconds: number, inside_sentence = true): Pause => ({
  start_seconds,
  end_seconds,
  duration_seconds: Math.round((end_seconds - start_seconds) * 100) / 100,
  inside_sentence,
});
