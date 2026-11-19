// Timeline markers for the audio player: scored fillers, pauses inside
// sentences, and coaching moments, all at their real times from the payloads.
// Natural pauses between sentences aren't issues, so they get no marker; the
// transcript still shows them. Watch-list words have no times in the analysis,
// so they can't be placed on the timeline either.

import type { AnalysisMetrics, FeedbackMoment } from "@/lib/types";

export type MomentKind = "strength" | "improve" | "filler" | "pause";

export type ReviewMoment = {
  id?: string;
  at: number;
  label: string;
  end?: number;
  text?: string;
  kind?: MomentKind;
  observation?: string;
  nextStep?: string;
  // Where playback starts, when that isn't `at`. Set for pauses.
  playFrom?: number;
};

type WordTime = { start: number; end: number };

// A pause inside a sentence lasts well under a second. Starting playback at
// the instant it begins leaves nothing to hear, and a browser's seek can land
// a little late and miss it altogether. So a pause is replayed from the start
// of the word before it: in "I want [pause] food" you hear "want", the
// silence, then "food". Without a timed word before it (a pause at the very
// start, or no transcript), playback starts this much earlier instead.
export const PAUSE_LEAD_IN_SECONDS = 1;

/**
 * Where to start playing a pause that begins at `pauseStart`: the start of the
 * last word that begins before it, otherwise a short lead-in clamped to zero.
 */
export function pauseReplayStart(pauseStart: number, words: readonly WordTime[] = []) {
  let before: WordTime | undefined;
  for (const word of words) {
    if (word.start < pauseStart && (!before || word.start > before.start)) before = word;
  }
  return before ? before.start : Math.max(0, pauseStart - PAUSE_LEAD_IN_SECONDS);
}

/** Where playback should start for a moment. Only pauses start early. */
export function replayStart(moment: Pick<ReviewMoment, "at" | "kind" | "playFrom">) {
  if (moment.playFrom !== undefined) return moment.playFrom;
  return moment.kind === "pause" ? pauseReplayStart(moment.at) : moment.at;
}

export const momentKindLabels: Record<MomentKind, string> = {
  filler: "Filler word",
  pause: "Pause inside a sentence",
  improve: "Coaching: try this",
  strength: "Coaching: strength",
};

// `words` are the transcript's word times (wordTimes in lib/transcript.ts),
// used to start each pause at the word before it.
export function momentsFromAnalysis(metrics: AnalysisMetrics | undefined, words: readonly WordTime[] = []): ReviewMoment[] {
  if (!metrics) return [];
  const fillers = metrics.filler_occurrences.map((filler, index): ReviewMoment => ({
    id: `filler-${index}`,
    at: filler.start_seconds,
    end: filler.end_seconds,
    kind: "filler",
    label: `Filler “${filler.filler}”`,
  }));
  const pauses = metrics.pauses
    .filter((pause) => pause.inside_sentence !== false)
    .map((pause, index): ReviewMoment => {
      const seconds = pause.duration_seconds ?? pause.end_seconds - pause.start_seconds;
      return {
        id: `pause-${index}`,
        at: pause.start_seconds,
        end: pause.end_seconds,
        kind: "pause",
        playFrom: pauseReplayStart(pause.start_seconds, words),
        label: `Pause inside sentence, ${seconds.toFixed(1)} s`,
      };
    });
  return [...fillers, ...pauses].sort((a, b) => a.at - b.at);
}

export function momentsFromFeedback(moments: FeedbackMoment[] | undefined): ReviewMoment[] {
  return (moments ?? []).map((moment) => ({
    id: moment.id,
    at: moment.start_seconds,
    end: moment.end_seconds,
    label: moment.kind === "strength" ? "Strength" : "Try this",
    text: moment.text,
    kind: moment.kind,
    observation: moment.observation,
    nextStep: moment.next_step,
  }));
}

export type MomentCluster = {
  // Position along the timeline, 0 to 100.
  percent: number;
  moments: ReviewMoment[];
};

// Smallest distance between markers before they merge, about one fingertip.
export const MIN_MARKER_GAP_PX = 24;

// Groups moments that would sit closer than minGapPx on a timeline trackWidth
// pixels wide. Each cluster sits at the average position of its moments, and
// no two clusters end up closer than minGapPx, so tap areas never overlap.
export function clusterMoments(moments: ReviewMoment[], duration: number, trackWidth: number, minGapPx = MIN_MARKER_GAP_PX): MomentCluster[] {
  if (duration <= 0 || trackWidth <= 0) return [];
  const sorted = moments
    .filter((moment) => Number.isFinite(moment.at) && moment.at >= 0 && moment.at <= duration)
    .sort((a, b) => a.at - b.at);
  const groups: ReviewMoment[][] = [];
  let groupStart = -Infinity;
  for (const moment of sorted) {
    const px = (moment.at / duration) * trackWidth;
    if (px - groupStart < minGapPx) {
      groups[groups.length - 1].push(moment);
    } else {
      groups.push([moment]);
      groupStart = px;
    }
  }
  const centre = (group: ReviewMoment[]) => group.reduce((sum, moment) => sum + moment.at, 0) / group.length;
  // Centring can pull neighbours back within the gap; merge those until none are.
  for (let index = 1; index < groups.length;) {
    const gapPx = ((centre(groups[index]) - centre(groups[index - 1])) / duration) * trackWidth;
    if (gapPx < minGapPx) {
      groups.splice(index - 1, 2, [...groups[index - 1], ...groups[index]]);
      index = Math.max(1, index - 1);
    } else {
      index += 1;
    }
  }
  return groups.map((group) => ({ percent: (centre(group) / duration) * 100, moments: group }));
}

// The first moment after (or the last before) the given time, for keyboard
// "next/previous issue" buttons. A small margin skips the moment just reached.
export function nextMoment(moments: ReviewMoment[], seconds: number, direction: 1 | -1, margin = 0.75) {
  const sorted = [...moments].sort((a, b) => a.at - b.at);
  return direction === 1
    ? sorted.find((moment) => moment.at > seconds + margin)
    : sorted.findLast((moment) => moment.at < seconds - margin);
}
