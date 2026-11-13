import { describe, expect, it } from "vitest";
import { activeSentenceIndex, placePauses, type Sentence } from "@/lib/transcript";

const word = (text: string, start: number, end: number) => ({ text, start, end, filler: false });

const sentences: Sentence[] = [
  { id: 0, start: 1, end: 3, text: "Hello there everyone.", words: [word("Hello", 1, 1.4), word("there", 2, 2.4), word("everyone.", 2.5, 3)] },
  { id: 1, start: 4, end: 5, text: "Next point.", words: [word("Next", 4, 4.4), word("point.", 4.6, 5)] },
];

describe("activeSentenceIndex", () => {
  it("returns -1 before the first sentence", () => {
    expect(activeSentenceIndex(sentences, 0.5)).toBe(-1);
    expect(activeSentenceIndex([], 3)).toBe(-1);
  });

  it("keeps a sentence current through the gap before the next one", () => {
    expect(activeSentenceIndex(sentences, 1)).toBe(0);
    expect(activeSentenceIndex(sentences, 3.6)).toBe(0);
    expect(activeSentenceIndex(sentences, 4)).toBe(1);
    expect(activeSentenceIndex(sentences, 99)).toBe(1);
  });
});

describe("placePauses", () => {
  it("places a pause after the word it follows, inside a sentence", () => {
    const pause = { start_seconds: 1.4, end_seconds: 2, inside_sentence: true };
    const placement = placePauses(sentences, [pause]);
    expect(placement.afterWord.get("0:0")).toEqual([pause]);
    expect(placement.afterSentence.size).toBe(0);
  });

  it("places a pause after a sentence's last word between sentences", () => {
    const pause = { start_seconds: 3, end_seconds: 4, inside_sentence: false };
    const placement = placePauses(sentences, [pause]);
    expect(placement.afterSentence.get(0)).toEqual([pause]);
    expect(placement.afterWord.size).toBe(0);
  });

  it("tolerates small rounding differences and groups pauses at the same spot", () => {
    const first = { start_seconds: 2.37, end_seconds: 2.5 };
    const second = { start_seconds: 2.38, end_seconds: 2.5 };
    expect(placePauses(sentences, [first, second]).afterWord.get("0:1")).toEqual([first, second]);
  });

  it("skips pauses before any word", () => {
    const placement = placePauses(sentences, [{ start_seconds: 0, end_seconds: 0.8 }, { start_seconds: 1.2, end_seconds: 1.3 }]);
    expect(placement.afterWord.size + placement.afterSentence.size).toBe(0);
  });
});
