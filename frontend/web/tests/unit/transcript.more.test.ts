import { describe, expect, it } from "vitest";
import { toSentences } from "@/lib/transcript";
import type { AnalysisMetrics, TranscriptItem } from "@/lib/types";

const metrics = (overrides: Partial<AnalysisMetrics> = {}): AnalysisMetrics => ({
  duration_seconds: 1, words_per_minute: 120, fillers_per_100_words: 0, pauses_per_speaking_minute: 0,
  rubric_scores: { speaking_rate: null, filler_words: null, pauses_inside_sentences: null },
  filler_occurrences: [], pauses: [], long_pauses: [], ...overrides,
});
const word = (content: string, start = 0, end = 0.5): TranscriptItem => ({ type: "pronunciation", start_time: String(start), end_time: String(end), alternatives: [{ content }] });

describe("transcript malformed and boundary inputs", () => {
  it("ignores punctuation before a sentence and continues after it", () => {
    expect(toSentences([{ type: "punctuation", alternatives: [{ content: "." }] }, word("One"), { type: "punctuation", alternatives: [{ content: "!" }] }, word("Two", 1, 1.5)], metrics())).toMatchObject([
      { start: 0, end: 0.5, text: "One!" }, { start: 1, end: 1.5, text: "Two" },
    ]);
  });
  it("tags a pause at the sentence end while ignoring metrics outside it", () => {
    const result = toSentences([word("Hello", 1, 2), { type: "punctuation", alternatives: [{ content: "." }] }], metrics({ pauses: [{ start_seconds: 2, end_seconds: 2.5 }] }));
    expect(result[0].tag).toBe("PAUSE");
  });
  it("skips malformed timestamps without poisoning later valid sentences", () => {
    const malformed: TranscriptItem = { type: "pronunciation", start_time: "nope", end_time: "nan", alternatives: [{ content: "bad" }] };
    expect(toSentences([malformed, word("Good", 3, 4), { type: "punctuation", alternatives: [{ content: "?" }] }], metrics())).toMatchObject([{ start: 3, end: 4, text: "Good?" }]);
  });
  it("handles empty alternatives and empty punctuation content without throwing", () => {
    expect(toSentences([{ type: "pronunciation", start_time: "1", end_time: "2", alternatives: [] }, { type: "punctuation", alternatives: [] }], metrics())).toMatchObject([]);
  });
});
