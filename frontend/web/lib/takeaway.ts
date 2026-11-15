// What the results page leads with: one strength, one priority, the evidence
// behind them and one next step.
//
// Nothing here is invented. With coaching, the lines come from the coaching
// payload. Without it, they are read straight off the rubric scores and
// measured values, and every line says which of the two it came from. There is
// no overall score, and no claim about improvement over earlier attempts.

import { minimumSpeakingSeconds, rubric, type RubricMetric } from "@/lib/rubric";
import { compareToTarget, metricDisplay, targetText } from "@/lib/targets";
import type { AnalysisMetrics, RecordingReview } from "@/lib/types";

export type Source = "coaching" | "measurements";

export type TakeawayLine = {
  label: "Strength" | "Closest to target" | "Work on";
  title: string;
  text: string;
  source: Source;
  /** Where in the recording this was heard, when coaching points at a moment. */
  at?: number;
};

export type Takeaway = {
  coached: boolean;
  /** The coach's own summary, when there is one. */
  overview: string[];
  strength?: TakeawayLine;
  priority?: TakeawayLine;
  /** Said instead of a line that cannot honestly be given. */
  note?: string;
};

export type Evidence = { at: number; label: string; detail?: string };

type Scored = { metric: RubricMetric; score: number };

export function scoredMetrics(metrics: AnalysisMetrics): Scored[] {
  return rubric
    .map((metric) => ({ metric, score: metrics.rubric_scores[metric.key] }))
    .filter((entry): entry is Scored => entry.score !== null);
}

/** The lowest rubric score; the first in rubric order when scores tie. */
export function lowestScored(metrics: AnalysisMetrics): Scored | undefined {
  return [...scoredMetrics(metrics)].sort((a, b) => a.score - b.score)[0];
}

function measuredLine({ metric, score }: Scored, label: TakeawayLine["label"], metrics: AnalysisMetrics): TakeawayLine {
  const display = metricDisplay(metric.key);
  const value = display.value(metrics);
  const comparison = compareToTarget(value, display.band, score);
  return {
    label,
    title: metric.title,
    text: `${value} ${display.unit}, score ${score} of 4. ${comparison}${score === 4 ? "" : ` (target: ${targetText(metric.key)})`}.`,
    source: "measurements",
  };
}

function measuredTakeaway(metrics: AnalysisMetrics): Pick<Takeaway, "strength" | "priority" | "note"> {
  const scored = scoredMetrics(metrics);
  if (scored.length === 0) return { note: `Record at least ${minimumSpeakingSeconds} seconds of speech to get scores.` };
  const best = [...scored].sort((a, b) => b.score - a.score)[0];
  const worst = lowestScored(metrics)!;
  if (best.score === worst.score) {
    // No measure stands out, so none is singled out as a strength.
    if (best.score === 4) return { note: "Every scored measure is in the target range." };
    return {
      priority: measuredLine(worst, "Work on", metrics),
      note: scored.length > 1 ? `Your scored measures are level at ${worst.score} of 4, so none stands out as a strength yet.` : undefined,
    };
  }
  return {
    // "Strength" is only claimed for a score of 3 or 4.
    strength: measuredLine(best, best.score >= 3 ? "Strength" : "Closest to target", metrics),
    priority: measuredLine(worst, "Work on", metrics),
  };
}

export function buildTakeaway(review: RecordingReview, metrics?: AnalysisMetrics): Takeaway {
  const measured = metrics ? measuredTakeaway(metrics) : { note: "No measurements are available for this recording." };
  const feedback = review.feedback;
  if (!feedback) return { coached: false, overview: [], ...measured };

  const moments = feedback.moments ?? [];
  const fromMoment = (kind: "strength" | "improve", label: TakeawayLine["label"]): TakeawayLine | undefined => {
    const moment = moments.find((item) => item.kind === kind);
    return moment && { label, title: `“${moment.text}”`, text: moment.observation, source: "coaching", at: moment.start_seconds };
  };
  const general = feedback.categories?.general;
  const strength = fromMoment("strength", "Strength") ?? measured.strength;
  const priority = fromMoment("improve", "Work on") ?? measured.priority;
  return {
    coached: true,
    overview: [feedback.feedback, general?.observation].filter((text): text is string => Boolean(text)),
    strength,
    priority,
    note: strength || priority ? undefined : measured.note,
  };
}

/** One thing to do next, and where that advice came from. */
export function buildNextStep(review: RecordingReview, metrics?: AnalysisMetrics): { text: string; source?: string } {
  const general = review.feedback?.categories?.general;
  if (general) return { text: general.next_step, source: "From coaching" };
  const lowest = metrics && lowestScored(metrics);
  if (lowest) return { text: lowest.metric.tips[lowest.score], source: `Rubric tip for your lowest score: ${lowest.metric.title}` };
  return { text: `Record at least ${minimumSpeakingSeconds} seconds of speech to get scores and a next step.` };
}

// How many measured events of each kind to list when there is no coaching.
const MEASURED_EVIDENCE = 3;

/** Moments worth replaying: the coach's, or else real filler and pause times. */
export function buildEvidence(review: RecordingReview, metrics?: AnalysisMetrics): { items: Evidence[]; source?: Source } {
  const moments = review.feedback?.moments ?? [];
  if (moments.length > 0) {
    return {
      source: "coaching",
      items: moments.map((moment) => ({
        at: moment.start_seconds,
        label: `${moment.kind === "strength" ? "Strength" : "Try this"} · “${moment.text}”`,
        detail: moment.observation,
      })),
    };
  }
  if (!metrics) return { items: [] };
  const pauses = metrics.pauses
    .filter((pause) => pause.inside_sentence !== false)
    .map((pause) => ({ ...pause, seconds: pause.duration_seconds ?? pause.end_seconds - pause.start_seconds }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, MEASURED_EVIDENCE)
    .map((pause): Evidence => ({ at: pause.start_seconds, label: `Pause inside a sentence, ${pause.seconds.toFixed(1)} s`, detail: "One of the longest" }));
  const fillers = metrics.filler_occurrences
    .slice(0, MEASURED_EVIDENCE)
    .map((filler): Evidence => ({ at: filler.start_seconds, label: `Filler “${filler.filler}”`, detail: "Among the first" }));
  const items = [...fillers, ...pauses].sort((a, b) => a.at - b.at);
  return { items, source: items.length ? "measurements" : undefined };
}
