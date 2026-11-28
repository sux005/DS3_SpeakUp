import { describe, expect, it } from "vitest";
import { PRACTICE_PROMPTS, PRACTICE_SECONDS, getPrompt, nextPrompt, promptDescription } from "@/lib/practice-prompts";

describe("practice prompts", () => {
  it("keeps every topic open ended with a few points and a unique id", () => {
    expect(PRACTICE_SECONDS).toBe(120);
    expect(new Set(PRACTICE_PROMPTS.map((prompt) => prompt.id)).size).toBe(PRACTICE_PROMPTS.length);
    for (const prompt of PRACTICE_PROMPTS) {
      expect(prompt.title.length).toBeGreaterThan(0);
      expect(prompt.intro.length).toBeGreaterThan(0);
      expect(prompt.points.length).toBeGreaterThanOrEqual(3);
      expect(prompt.points.length).toBeLessThanOrEqual(5);
    }
  });

  it("finds prompts by id and cycles to a different one", () => {
    expect(getPrompt("place")?.title).toBe("A place you love");
    expect(getPrompt("missing")).toBeUndefined();
    expect(getPrompt(null)).toBeUndefined();
    expect(nextPrompt(PRACTICE_PROMPTS[0])).toBe(PRACTICE_PROMPTS[1]);
    expect(nextPrompt(PRACTICE_PROMPTS.at(-1)!)).toBe(PRACTICE_PROMPTS[0]);
  });

  it("describes the prompt for the saved presentation", () => {
    const text = promptDescription(PRACTICE_PROMPTS[0]);
    expect(text).toContain(PRACTICE_PROMPTS[0].intro);
    for (const point of PRACTICE_PROMPTS[0].points) expect(text).toContain(point);
  });
});
