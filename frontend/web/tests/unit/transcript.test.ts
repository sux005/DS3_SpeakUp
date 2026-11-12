import { describe, expect, it } from "vitest";
import { toSentences } from "@/lib/transcript";
import type { AnalysisMetrics, TranscriptItem } from "@/lib/types";

const metrics = (overrides: Partial<AnalysisMetrics> = {}): AnalysisMetrics => ({
  duration_seconds: 10,
  words_per_minute: 120,
  fillers_per_100_words: 1,
  pauses_per_speaking_minute: 1,
  rubric_scores: { speaking_rate: 3, filler_words: 3, pauses_inside_sentences: 3 },
  filler_occurrences: [],
  pauses: [],
  long_pauses: [],
  ...overrides,
});

const pronunciation = (content: string, start: number, end: number): TranscriptItem => ({ type: "pronunciation", start_time: String(start), end_time: String(end), alternatives: [{ content }] });
const punctuation = (content: string): TranscriptItem => ({ type: "punctuation", alternatives: [{ content }] });

describe("toSentences", () => {
  it("joins words and punctuation into sentence spans", () => {
    expect(toSentences([
      pronunciation("Hello", 0, 0.5),
      pronunciation("world", 0.6, 1.1),
      punctuation("."),
      pronunciation("Next", 2, 2.3),
      punctuation("?"),
    ], metrics())).toEqual([
      { start: 0, end: 1.1, text: "Hello world." },
      { start: 2, end: 2.3, text: "Next?" },
    ]);
  });

  it("flushes an unfinished sentence at end of input", () => {
    expect(toSentences([pronunciation("unfinished", 4, 5)], metrics())).toEqual([{ start: 4, end: 5, text: "unfinished" }]);
  });

  it("tags filler before pause when both occur inside the same sentence", () => {
    const result = toSentences([pronunciation("I", 0, 1), pronunciation("think", 1.1, 2), punctuation(".")], metrics({
      filler_occurrences: [{ filler: "think", start_seconds: 1.5, end_seconds: 1.7 }],
      pauses: [{ start_seconds: 1.8, end_seconds: 2.2 }],
    }));
    expect(result[0].tag).toBe("FILLER");
  });

  it("tags pauses at inclusive sentence boundaries and ignores unrelated metrics", () => {
    const result = toSentences([pronunciation("Boundary", 3, 4), punctuation("!")], metrics({ pauses: [{ start_seconds: 3, end_seconds: 3.1 }] }));
    expect(result[0]).toMatchObject({ text: "Boundary!", tag: "PAUSE" });
    expect(toSentences([], metrics())).toEqual([]);
  });

  it("skips pronunciation items with missing timestamps", () => {
    const result = toSentences([{ type: "pronunciation", alternatives: [] }, punctuation(".")], metrics());
    expect(result).toEqual([]);
  });
});
