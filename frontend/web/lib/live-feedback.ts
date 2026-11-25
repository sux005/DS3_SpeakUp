// A provisional reading of browser-recognized words, including interim words. The saved
// rubric uses timed Amazon Transcribe words and remains the source of scores.
const scoredSingles = new Set(["um", "uh", "er", "erm", "ah"]);
const youKnowExclusions = new Set(["do", "did", "don't", "if", "as", "would", "to"]);

export type LiveWord = { text: string; filler: boolean };

export function liveFeedback(text: string, elapsedSeconds: number) {
  const parts = text.match(/\s+|\S+/g) ?? [];
  const words = parts.flatMap((part, index) => {
    if (/^\s+$/.test(part)) return [];
    const token = part.toLowerCase().replace(/’/g, "'").replace(/^[^\w']+|[^\w']+$/g, "");
    return token ? [{ index, token, sentenceEnd: /[.?!][^\w]*$/.test(part) }] : [];
  });
  const marked = new Set<number>();
  let fillerCount = 0;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (scoredSingles.has(word.token)) {
      marked.add(word.index);
      fillerCount += 1;
    }
    if (word.token === "you" && words[index + 1]?.token === "know" && !word.sentenceEnd &&
      !(index > 0 && !words[index - 1].sentenceEnd && youKnowExclusions.has(words[index - 1].token))) {
      marked.add(word.index);
      marked.add(words[index + 1].index);
      fillerCount += 1;
    }
  }

  const spokenWords = words.filter((word) => !marked.has(word.index)).length;
  // Browser recognition has no word timestamps. This uses wall-clock recording
  // time and waits for a small sample rather than implying rubric precision.
  const pace = elapsedSeconds >= 5 && spokenWords >= 5
    ? Math.round((spokenWords * 60) / elapsedSeconds)
    : null;

  return {
    words: parts.map((part, index): LiveWord => ({ text: part, filler: marked.has(index) })),
    fillerCount,
    spokenWords,
    fillersPer100Words: spokenWords ? (fillerCount * 100) / spokenWords : null,
    pace,
  };
}
