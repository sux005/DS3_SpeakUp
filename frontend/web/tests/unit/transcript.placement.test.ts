import { describe, expect, it } from "vitest";
import { activeSentenceIndex, placePauses, type Sentence } from "@/lib/transcript";
import { pause as pauseOf } from "../fixtures";

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
    const pause = pauseOf(1.4, 2);
    const placement = placePauses(sentences, [pause]);
    expect(placement.afterWord.get("0:0")).toEqual([pause]);
    expect(placement.afterSentence.size).toBe(0);
  });

  it("places a pause after a sentence's last word between sentences", () => {
    const pause = pauseOf(3, 4, false);
    const placement = placePauses(sentences, [pause]);
    expect(placement.afterSentence.get(0)).toEqual([pause]);
    expect(placement.afterWord.size).toBe(0);
  });

  it("tolerates small rounding differences and groups pauses at the same spot", () => {
    const first = pauseOf(2.37, 2.5);
    const second = pauseOf(2.38, 2.5);
    expect(placePauses(sentences, [first, second]).afterWord.get("0:1")).toEqual([first, second]);
  });

  it("skips pauses before any word", () => {
    const placement = placePauses(sentences, [pauseOf(0, 0.8), pauseOf(1.2, 1.3)]);
    expect(placement.afterWord.size + placement.afterSentence.size).toBe(0);
  });
});
