import { describe, expect, it } from "vitest";
import { liveFeedback } from "@/lib/live-feedback";

describe("live speech estimates", () => {
  it("counts the rubric's scored fillers without counting watch words", () => {
    const result = liveFeedback("Um, I actually think uh this is like, useful. You know?", 30);
    expect(result.fillerCount).toBe(3);
    expect(result.spokenWords).toBe(7);
    expect(result.fillersPer100Words).toBeCloseTo(42.86, 2);
    expect(result.words.filter((part) => part.filler).map((part) => part.text)).toEqual(["Um,", "uh", "You", "know?"]);
  });

  it("respects the rubric's contextual you know exclusion", () => {
    expect(liveFeedback("Do you know the answer?", 30).fillerCount).toBe(0);
    expect(liveFeedback("I do. You know the answer?", 30).fillerCount).toBe(1);
  });

  it("starts a provisional pace after five seconds and five recognized words", () => {
    expect(liveFeedback("One two three four five", 4).pace).toBeNull();
    expect(liveFeedback("One two three four", 5).pace).toBeNull();
    expect(liveFeedback("One two three four five", 5).pace).toBe(60);
  });
});
