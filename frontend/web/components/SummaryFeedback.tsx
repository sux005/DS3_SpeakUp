"use client";

// The overall summary, below the score cards, in three steps:
// what happened → supporting evidence → what to try next.
//
// With coaching (feedback schema 2), all three come from it: the overview and
// general observation, the anchored moments, and the general next step.
// Without coaching, the section says so plainly and shows only what can be
// stated honestly: the measured scores, the times of real filler and pause
// events, and the rubric's tip for the lowest score. Every part is labelled
// with where it came from, and no coaching text is made up.

import { formatClock } from "@/lib/recordings";
import { rubric } from "@/lib/rubric";
import type { AnalysisMetrics, RecordingReview } from "@/lib/types";

type Evidence = { at: number; label: string; detail?: string };

// How many measured events to list when there is no coaching.
const MEASURED_EVIDENCE = 3;

function measuredEvidence(metrics: AnalysisMetrics): Evidence[] {
  const pauses = metrics.pauses
    .filter((pause) => pause.inside_sentence !== false)
    .map((pause) => ({ ...pause, seconds: pause.duration_seconds ?? pause.end_seconds - pause.start_seconds }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, MEASURED_EVIDENCE)
    .map((pause): Evidence => ({ at: pause.start_seconds, label: `Pause inside a sentence, ${pause.seconds.toFixed(1)} s`, detail: "One of the longest" }));
  const fillers = metrics.filler_occurrences
    .slice(0, MEASURED_EVIDENCE)
    .map((filler): Evidence => ({ at: filler.start_seconds, label: `Filler “${filler.filler}”`, detail: "Among the first" }));
  return [...fillers, ...pauses].sort((a, b) => a.at - b.at);
}

function lowestScored(metrics: AnalysisMetrics) {
  const scored = rubric
    .map((metric) => ({ metric, score: metrics.rubric_scores[metric.key] }))
    .filter((entry): entry is { metric: (typeof rubric)[number]; score: number } => entry.score !== null);
  return scored.sort((a, b) => a.score - b.score)[0];
}

function Step({ number, title, source, children }: { number: number; title: string; source?: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-teal font-mono text-sm text-cream dark:text-night">{number}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="font-display text-lg font-bold text-ink">
          {title}
          {source && <span className="mt-0.5 block font-mono text-[11px] font-normal uppercase text-muted">{source}</span>}
        </h3>
        {children}
      </div>
    </li>
  );
}

export function SummaryFeedback({ review, metrics, canSeek, onSeek }: {
  review: RecordingReview;
  metrics?: AnalysisMetrics;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
}) {
  const feedback = review.feedback;
  const general = feedback?.categories?.general;
  const moments = feedback?.moments ?? [];
  const evidence: Evidence[] = moments.length > 0
    ? moments.map((moment) => ({
      at: moment.start_seconds,
      label: `${moment.kind === "strength" ? "Strength" : "Try this"} · “${moment.text}”`,
      detail: moment.observation,
    }))
    : metrics ? measuredEvidence(metrics) : [];
  const evidenceSource = moments.length > 0 ? "From coaching" : "From your measurements";
  const lowest = metrics ? lowestScored(metrics) : undefined;

  return (
    <section aria-labelledby="summary-heading" className="flex w-full flex-col gap-5 rounded-md bg-pale p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[11px] uppercase text-teal">For your next take</p>
        <h2 id="summary-heading" className="font-display text-2xl font-bold text-ink">Overall summary</h2>
      </div>

      {!feedback && (
        <p role="status" className="rounded-sm border border-line bg-background p-3 text-sm text-ink">
          <span className="font-semibold">Coaching isn&apos;t available for this recording.</span>{" "}
          It may still be generating, or coaching may be turned off. The summary below uses only your measurements and the rubric.
        </p>
      )}

      <ol className="flex flex-col gap-6">
        <Step number={1} title="What happened" source={feedback ? "From coaching" : "From your measurements"}>
          {feedback ? (
            <>
              <p className="text-ink">{feedback.feedback}</p>
              {general && <p className="text-ink">{general.observation}</p>}
            </>
          ) : metrics ? (
            <ul className="flex flex-col gap-1 text-ink">
              {rubric.map((metric) => {
                const score = metrics.rubric_scores[metric.key];
                return <li key={metric.key}>{metric.title}: {score === null ? "not scored" : `${score}/4`}</li>;
              })}
            </ul>
          ) : (
            <p className="text-muted">No measurements are available for this recording.</p>
          )}
        </Step>

        <Step number={2} title="Supporting evidence" source={evidence.length ? evidenceSource : undefined}>
          {evidence.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {evidence.map((item) => (
                <li key={`${item.at}-${item.label}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <button
                    type="button"
                    disabled={!canSeek}
                    onClick={() => onSeek(item.at)}
                    aria-label={`Play from ${formatClock(item.at)}: ${item.label}`}
                    className="press min-h-8 cursor-pointer rounded-sm border border-teal px-2 font-mono text-xs text-teal hover:bg-teal hover:text-cream disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-teal"
                  >
                    ▶ {formatClock(item.at)}
                  </button>
                  <span className="text-ink">{item.label}</span>
                  {item.detail && <span className="w-full pl-0 text-sm text-muted sm:w-auto">{item.detail}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">No timed events to show.</p>
          )}
        </Step>

        <Step
          number={3}
          title="What to try next"
          source={general ? "From coaching" : lowest ? `Rubric tip for your lowest score: ${lowest.metric.title}` : undefined}
        >
          {general ? (
            <p className="text-ink">{general.next_step}</p>
          ) : lowest ? (
            <p className="text-ink">{lowest.metric.tips[lowest.score]}</p>
          ) : (
            <p className="text-muted">Record at least 60 seconds of speech to get scores and a next step.</p>
          )}
        </Step>
      </ol>
    </section>
  );
}
