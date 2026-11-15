"use client";

// One concise card per scored metric: the measured value and unit, the score
// out of 4, the target, and one line of interpretation. That line is the
// coaching category when the backend sent one; otherwise the plain difference
// from the target, labelled as measured. The definition, the rubric tip and
// the full rubric table open on request. Scores come straight from the
// analysis; nothing is recalculated here.

import { useId, useState } from "react";
import { RubricScore } from "@/components/RubricScore";
import { minimumSpeakingSeconds, rubric, type MetricKey, type RubricMetric } from "@/lib/rubric";
import { compareToTarget, metricDisplay, targetText } from "@/lib/targets";
import type { AnalysisMetrics, FeedbackCategory } from "@/lib/types";

type CoachingCategories = Partial<Record<"general" | "pace" | "fillers" | "pauses", FeedbackCategory>>;

const categoryFor: Record<MetricKey, "pace" | "fillers" | "pauses"> = {
  speaking_rate: "pace",
  filler_words: "fillers",
  pauses_inside_sentences: "pauses",
};

// Counts the analysis reports alongside each score, when it includes them.
function details(metric: MetricKey, metrics: AnalysisMetrics): string[] {
  if (metric === "filler_words") {
    const lines: string[] = [];
    const counts = Object.entries(metrics.filler_words ?? {}).map(([word, count]) => `${word} ×${count}`);
    if (metrics.filler_count !== undefined) lines.push(`${metrics.filler_count} scored fillers${counts.length ? `: ${counts.join(", ")}` : ""}`);
    const watch = Object.entries(metrics.watch_words ?? {}).map(([word, count]) => `“${word}” ×${count}`);
    if (watch.length) lines.push(`Watch list, not scored: ${watch.join(", ")}`);
    return lines;
  }
  if (metric === "pauses_inside_sentences") {
    const lines: string[] = [];
    if (metrics.pauses_inside_sentences !== undefined) lines.push(`${metrics.pauses_inside_sentences} pauses inside sentences (scored)`);
    if (metrics.pauses_between_sentences !== undefined) lines.push(`${metrics.pauses_between_sentences} natural pauses between sentences (not scored)`);
    return lines;
  }
  return [];
}

function ScoreCard({ metric, metrics, coaching }: { metric: RubricMetric; metrics: AnalysisMetrics; coaching?: FeedbackCategory }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const score = metrics.rubric_scores[metric.key];
  const display = metricDisplay(metric.key);
  const value = display.value(metrics);
  const [count, ...moreCounts] = details(metric.key, metrics);

  return (
    <article className="flex flex-col gap-3 rounded-2xl border-2 border-line bg-card p-5 sm:p-6" aria-labelledby={`${panelId}-title`}>
      <h3 id={`${panelId}-title`} className="font-display text-xl font-bold text-ink">{metric.title}</h3>

      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-4xl font-bold text-ink">{value}</span>
        <span className="text-[15px] text-muted">{display.unit}</span>
      </p>

      <div aria-label={score === null ? "Not scored" : `Score ${score} out of 4`} role="img">
        <RubricScore score={score} />
      </div>

      <p className="text-[15px] text-ink"><span className="font-semibold">Target:</span> {targetText(metric.key)}</p>

      {/* One line of interpretation: the coach's, or else plain arithmetic against the target. */}
      <div className="flex flex-col gap-1 border-t-2 border-line pt-3 text-[15px] text-ink">
        {coaching ? (
          <>
            <p className="label text-teal">Coaching</p>
            <p>{coaching.observation}</p>
            <p><span className="font-semibold">Next step:</span> {coaching.next_step}</p>
          </>
        ) : score === null ? (
          <p>Record at least {minimumSpeakingSeconds} seconds of speech to get a score.</p>
        ) : (
          <>
            <p className="label">Measured</p>
            <p>{compareToTarget(value, display.band, score)}.</p>
          </>
        )}
        {count && <p className="text-sm text-muted">{count}</p>}
      </div>

      <div className="mt-auto">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-11 w-full cursor-pointer items-center justify-between rounded-sm text-sm font-semibold text-teal hover:underline"
        >
          About this score
          <span aria-hidden="true" className={`rubric-chevron ${open ? "rotate-180" : ""}`}>▾</span>
        </button>
        <div id={panelId} className={`rubric-panel grid ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`} inert={!open}>
          <div className="flex flex-col gap-3 overflow-hidden text-[15px] text-ink">
            <p className="pt-1">{metric.measures}</p>
            {moreCounts.map((line) => <p key={line} className="text-sm text-muted">{line}</p>)}
            {!coaching && score !== null && (
              <div>
                <p className="label">Rubric tip for a score of {score}</p>
                <p>{metric.tips[score]}</p>
              </div>
            )}
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">{metric.title} rubric, {metric.unit}</caption>
              <thead>
                <tr className="label">
                  <th scope="col" className="border-b-2 border-line py-1.5 pr-3 font-semibold">Score</th>
                  <th scope="col" className="border-b-2 border-line py-1.5 font-semibold">Range</th>
                </tr>
              </thead>
              <tbody>
                {metric.bands.map((band) => (
                  <tr key={band.score} className={band.score === score ? "bg-pale font-semibold" : ""} aria-current={band.score === score ? "true" : undefined}>
                    <td className="border-b border-line py-1.5 pl-1 pr-3 font-display text-ink">{band.score}</td>
                    <td className="border-b border-line py-1.5 text-ink">
                      {band.range}
                      {band.score === score && <span className="sr-only"> (your score)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </article>
  );
}

export function ScoreCards({ metrics, categories }: { metrics: AnalysisMetrics; categories?: CoachingCategories }) {
  return (
    <div className="grid w-full gap-4 lg:grid-cols-3">
      {rubric.map((metric) => (
        <ScoreCard key={metric.key} metric={metric} metrics={metrics} coaching={categories?.[categoryFor[metric.key]]} />
      ))}
    </div>
  );
}
