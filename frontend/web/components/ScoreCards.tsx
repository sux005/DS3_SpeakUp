"use client";

// One card per scored metric, combining what used to be split between the score
// tiles, the rubric page and the coaching column: the measured value and unit,
// the score out of 4, the target range, what the metric measures, and feedback.
// Feedback is the coaching category when the backend sent one; otherwise the
// rubric's tip for that score, labelled as such. Scores and units come straight
// from the analysis; nothing is recalculated here.

import { useId, useState } from "react";
import { RubricScore } from "@/components/RubricScore";
import { minimumSpeakingSeconds, rubric, type MetricKey, type RubricMetric } from "@/lib/rubric";
import type { AnalysisMetrics, FeedbackCategory } from "@/lib/types";

type CoachingCategories = Partial<Record<"general" | "pace" | "fillers" | "pauses", FeedbackCategory>>;

const categoryFor: Record<MetricKey, "pace" | "fillers" | "pauses"> = {
  speaking_rate: "pace",
  filler_words: "fillers",
  pauses_inside_sentences: "pauses",
};

function measured(metric: MetricKey, metrics: AnalysisMetrics) {
  switch (metric) {
    case "speaking_rate":
      return { value: `${metrics.words_per_minute}`, unit: "WPM" };
    case "filler_words":
      return { value: `${metrics.fillers_per_100_words}`, unit: "per 100 words" };
    case "pauses_inside_sentences":
      return { value: `${metrics.pauses_per_speaking_minute}`, unit: "per speaking-min" };
  }
}

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
  const { value, unit } = measured(metric.key, metrics);
  const extra = details(metric.key, metrics);

  return (
    <article className="flex flex-col gap-4 rounded-md border border-line bg-cream p-5 dark:bg-night-soft sm:p-6" aria-labelledby={`${panelId}-title`}>
      <header className="flex flex-col gap-1">
        <h3 id={`${panelId}-title`} className="font-display text-xl font-bold text-ink">{metric.title}</h3>
        <p className="text-sm text-muted">{metric.measures}</p>
      </header>

      <div aria-label={score === null ? "Not scored" : `Score ${score} out of 4`} role="img">
        <RubricScore score={score} />
      </div>

      <dl className="grid grid-cols-2 gap-3 border-y border-line py-3 text-sm">
        <div>
          <dt className="font-mono text-[11px] uppercase text-muted">You measured</dt>
          <dd className="flex flex-col">
            <span className="font-display text-2xl font-bold text-ink">{value}</span>
            <span className="text-sm text-muted">{unit}</span>
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[11px] uppercase text-muted">Target range</dt>
          <dd className="pt-1.5 text-ink">{metric.bands[0].range}</dd>
        </div>
      </dl>

      {extra.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-muted">
          {extra.map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}

      <div className="flex flex-col gap-1 text-[15px] text-ink">
        {coaching ? (
          <>
            <p className="font-mono text-[11px] uppercase text-teal">Coaching</p>
            <p>{coaching.observation}</p>
            <p><span className="font-semibold">Next step:</span> {coaching.next_step}</p>
          </>
        ) : score === null ? (
          <p>Record at least {minimumSpeakingSeconds} seconds of speech to get a score.</p>
        ) : (
          <>
            <p className="font-mono text-[11px] uppercase text-teal">Rubric tip</p>
            <p>{metric.tips[score]}</p>
          </>
        )}
      </div>

      <div className="mt-auto">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-10 w-full cursor-pointer items-center justify-between rounded-sm font-mono text-xs uppercase text-teal hover:underline"
        >
          Full rubric
          <span aria-hidden="true" className={`rubric-chevron ${open ? "rotate-180" : ""}`}>▾</span>
        </button>
        <div id={panelId} className={`rubric-panel grid ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`} inert={!open}>
          <div className="overflow-hidden">
            <table className="mt-2 w-full border-collapse text-left text-sm">
              <caption className="sr-only">{metric.title} rubric, {metric.unit}</caption>
              <thead>
                <tr className="font-mono text-[11px] text-muted">
                  <th scope="col" className="border-b border-line py-1.5 pr-3 font-normal">SCORE</th>
                  <th scope="col" className="border-b border-line py-1.5 font-normal">RANGE</th>
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
