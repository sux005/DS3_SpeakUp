// How each rubric metric is read from a recording's metrics and compared with
// its score-4 target. The numbers here are for display and plotting only: the
// score always comes from the backend, and the target wording from lib/rubric.ts.

import { rubric, type MetricKey } from "@/lib/rubric";
import type { SummaryMetrics } from "@/lib/types";

export type MetricDisplay = {
  key: MetricKey;
  unit: string;
  /** The score-4 target as numbers. */
  band: [number, number];
  /** From the rubric's best threshold to its worst. */
  scale: [number, number];
  value: (metrics: SummaryMetrics) => number;
};

export const metricDisplays: MetricDisplay[] = [
  { key: "speaking_rate", unit: "WPM", band: [135, 155], scale: [90, 200], value: (m) => m.words_per_minute },
  { key: "filler_words", unit: "per 100 words", band: [0, 2], scale: [0, 8], value: (m) => m.fillers_per_100_words },
  { key: "pauses_inside_sentences", unit: "per speaking-minute", band: [0, 9], scale: [0, 18], value: (m) => m.pauses_per_speaking_minute },
];

export function metricDisplay(key: MetricKey) {
  return metricDisplays.find((display) => display.key === key)!;
}

export const trim = (value: number) => Number(value.toFixed(2));

/** The rubric's own wording for a score of 4, ready to follow "Target:". */
export function targetText(key: MetricKey) {
  const range = rubric.find((metric) => metric.key === key)!.bands[0].range;
  return range.charAt(0).toLowerCase() + range.slice(1);
}

/**
 * Where a value sits against its target, by plain subtraction. It never
 * decides whether a value is on target: a score of 4 is the backend saying so,
 * and a value on the boundary without that score gets no claim either way.
 */
export function compareToTarget(value: number, [low, high]: [number, number], score: number | null) {
  if (score === 4) return "In the target range";
  if (value < low) return `${trim(low - value)} below the target range`;
  if (value > high) return `${trim(value - high)} above the target`;
  return "At the edge of the target range";
}
