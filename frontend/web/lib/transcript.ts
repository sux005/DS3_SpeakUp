import type { AnalysisMetrics, TranscriptItem } from "@/lib/types";

export type Word = {
  start: number;
  end: number;
  // The spoken word plus any punctuation that follows it, e.g. "Um,".
  text: string;
  filler: boolean;
};

export type Sentence = {
  // Position in the transcript, used as a React key. Start times can repeat.
  id: number;
  start: number;
  end: number;
  words: Word[];
  text: string;
  tag?: "FILLER" | "PAUSE";
};

// Two times are the same moment if they differ by less than this. The
// analysis rounds to 2 decimals; the transcript keeps 3.
const SAME_MOMENT = 0.02;

// Joins Transcribe's word-by-word items into sentences, marks each filler
// word found by the analysis, and tags each sentence with the first filler
// or pause inside it.
export function toSentences(items: TranscriptItem[], metrics: AnalysisMetrics) {
  const isFiller = (start: number) =>
    metrics.filler_occurrences.some((f) => Math.abs(f.start_seconds - start) < SAME_MOMENT);

  const sentences: Sentence[] = [];
  let current: Sentence | undefined;

  for (const item of items) {
    const content = item.alternatives[0]?.content ?? "";
    if (item.type === "pronunciation") {
      if (!content.trim() || item.start_time === undefined || item.end_time === undefined) continue;
      if (!Number.isFinite(Number(item.start_time)) || !Number.isFinite(Number(item.end_time))) continue;
      const word: Word = {
        start: Number(item.start_time),
        end: Number(item.end_time),
        text: content,
        filler: isFiller(Number(item.start_time)),
      };
      if (!current) current = { id: sentences.length, start: word.start, end: word.end, words: [], text: "" };
      current.text += `${current.words.length ? " " : ""}${content}`;
      current.words.push(word);
      current.end = word.end;
    } else if (current) {
      const last = current.words.at(-1);
      if (last) last.text += content;
      current.text += content;
      if (/[.?!]/.test(content)) {
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
