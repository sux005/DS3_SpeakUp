import type { AnalysisMetrics, TranscriptItem } from "@/lib/types";

export type Sentence = {
  start: number;
  end: number;
  text: string;
  tag?: "FILLER" | "PAUSE";
};

// Joins Transcribe's word-by-word items into sentences, and tags each
// sentence with the first filler or pause found inside it.
export function toSentences(items: TranscriptItem[], metrics: AnalysisMetrics) {
  const sentences: Sentence[] = [];
  let current: Sentence | undefined;

  for (const item of items) {
    const word = item.alternatives[0]?.content ?? "";
    if (item.type === "pronunciation") {
      if (!word.trim()) continue;
      const start = Number(item.start_time);
      const end = Number(item.end_time);
      // Transcribe timestamps are required to place a word in the review
      // timeline. Ignore malformed items rather than leaking NaN into the UI.
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (!current) {
        current = { start, end, text: word };
      } else {
        current.text += ` ${word}`;
        current.end = end;
      }
    } else if (current) {
      current.text += word;
      if (/[.?!]/.test(word)) {
        sentences.push(current);
        current = undefined;
      }
    }
  }
  if (current) sentences.push(current);

  const within = (s: Sentence, seconds: number) => seconds >= s.start && seconds <= s.end;
  for (const sentence of sentences) {
    if (metrics.filler_occurrences.some((f) => within(sentence, f.start_seconds))) {
      sentence.tag = "FILLER";
    } else if (metrics.pauses.some((p) => within(sentence, p.start_seconds))) {
      sentence.tag = "PAUSE";
    }
  }
  return sentences;
}
