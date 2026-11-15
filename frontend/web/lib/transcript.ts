import type { AnalysisMetrics, Pause, TranscriptItem } from "@/lib/types";

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
// or pause inside it. Pauses the analysis marks as between sentences don't count.
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
    } else if (metrics.pauses.some((p) => p.inside_sentence !== false && within(sentence, p.start_seconds))) {
      sentence.tag = "PAUSE";
    }
  }
  return sentences;
}

// The sentence playing at a given time. A sentence stays current until the next
// one starts, so the highlight doesn't flicker off during gaps between them.
// Returns -1 before the first word.
export function activeSentenceIndex(sentences: Sentence[], seconds: number) {
  let low = 0;
  let high = sentences.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (sentences[middle].start <= seconds) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

// Where each pause sits in the transcript: after a word inside a sentence
// (keyed "sentenceId:wordIndex"), or after a sentence (keyed by sentence id).
// Position comes from timing; whether a pause counts as inside or between a
// sentence comes from the backend's inside_sentence flag, which drives scoring.
export type PausePlacement = {
  afterWord: Map<string, Pause[]>;
  afterSentence: Map<number, Pause[]>;
};

// Pause starts and word ends can differ slightly after rounding.
const PAUSE_TOLERANCE = 0.05;

export function placePauses(sentences: Sentence[], pauses: Pause[]): PausePlacement {
  const placement: PausePlacement = { afterWord: new Map(), afterSentence: new Map() };
  const add = <K,>(map: Map<K, Pause[]>, key: K, pause: Pause) => map.set(key, [...(map.get(key) ?? []), pause]);

  for (const pause of pauses) {
    const at = pause.start_seconds + PAUSE_TOLERANCE;
    const index = activeSentenceIndex(sentences, at);
    if (index === -1) continue;
    const sentence = sentences[index];
    const wordIndex = sentence.words.findLastIndex((word) => word.end <= at);
    if (wordIndex === -1) continue;
    if (wordIndex === sentence.words.length - 1) add(placement.afterSentence, sentence.id, pause);
    else add(placement.afterWord, `${sentence.id}:${wordIndex}`, pause);
  }
  return placement;
}
