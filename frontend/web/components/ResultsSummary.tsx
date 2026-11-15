"use client";

// The parts of the results page that say what to take from a recording:
// the takeaway at the top, the evidence list inside the review panel, and the
// single next step. All wording comes from lib/takeaway.ts, which labels each
// line as coaching or as a measurement and never makes anything up.

import { ButtonLink } from "@/components/Button";
import { Mascot } from "@/components/Mascot";
import { formatClock } from "@/lib/recordings";
import { buildEvidence, buildNextStep, buildTakeaway, type Source, type TakeawayLine } from "@/lib/takeaway";
import type { AnalysisMetrics, RecordingReview } from "@/lib/types";

const sourceLabel: Record<Source, string> = {
  coaching: "From coaching",
  measurements: "From your measurements",
};

function PlayIcon() {
  return <svg aria-hidden="true" viewBox="0 0 10 12" className="mr-1.5 inline-block h-2.5 w-2 fill-current align-baseline"><path d="M0 0l10 6-10 6z" /></svg>;
}

function Line({ line, canSeek, onSeek }: { line: TakeawayLine; canSeek: boolean; onSeek: (seconds: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border-2 border-line bg-card p-4">
      <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className={`rounded-md px-2 py-0.5 text-sm font-bold ${line.label === "Work on" ? "bg-peach text-night" : "bg-teal text-cream dark:text-night"}`}>{line.label}</span>
        <span className="text-lg font-bold text-ink">{line.title}</span>
      </p>
      <p className="text-ink">{line.text}</p>
      {line.points && (
        <ul className="flex flex-col gap-1 text-[15px] text-ink">
          {line.points.map((point) => <li key={point}>{point}</li>)}
        </ul>
      )}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span>{sourceLabel[line.source]}</span>
        {line.at !== undefined && (
          <button
            type="button"
            disabled={!canSeek}
            onClick={() => onSeek(line.at!)}
            className="press min-h-8 cursor-pointer rounded-lg border-2 border-teal px-2 font-mono text-xs text-teal hover:bg-teal hover:text-cream dark:hover:text-night disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-teal"
          >
            <PlayIcon />Play from {formatClock(line.at)}
          </button>
        )}
      </p>
    </div>
  );
}

/** One strength and one priority, with where each came from. */
export function Takeaway({ review, metrics, canSeek, onSeek }: {
  review: RecordingReview;
  metrics?: AnalysisMetrics;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
}) {
  const takeaway = buildTakeaway(review, metrics);
  return (
    <section aria-labelledby="takeaway-heading" className="flex w-full gap-5 rounded-3xl bg-pale p-5 sm:gap-7 sm:p-7">
      <Mascot state="results" className="hidden w-24 shrink-0 self-end sm:block md:w-28" sizes="192px" />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <h2 id="takeaway-heading" className="font-display text-2xl font-bold text-ink">Your takeaway</h2>
        {takeaway.overview.map((text) => <p key={text} className="text-[17px] text-ink">{text}</p>)}
        {(takeaway.strength || takeaway.priority) && (
          <div className="grid gap-3 md:grid-cols-2">
            {takeaway.strength && <Line line={takeaway.strength} canSeek={canSeek} onSeek={onSeek} />}
            {takeaway.priority && <Line line={takeaway.priority} canSeek={canSeek} onSeek={onSeek} />}
          </div>
        )}
        {takeaway.note && <p className="text-ink">{takeaway.note}</p>}
        {!takeaway.coached && (
          <p role="status" className="text-sm text-muted">
            <span className="font-semibold">Coaching isn&apos;t available for this recording.</span>{" "}
            It may still be generating, or coaching may be turned off. This takeaway uses only your measurements and the rubric.
          </p>
        )}
      </div>
    </section>
  );
}

/** Moments to replay, for the dark review panel. Each one plays from its time. */
export function EvidenceList({ review, metrics, canSeek, onSeek }: {
  review: RecordingReview;
  metrics?: AnalysisMetrics;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
}) {
  const { items, source } = buildEvidence(review, metrics);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-display text-xl font-bold text-cream">Moments to replay</h3>
        {source && <p className="text-sm text-mint">{sourceLabel[source]}</p>}
      </div>
      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={`${item.at}-${item.label}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <button
                type="button"
                disabled={!canSeek}
                onClick={() => onSeek(item.at)}
                aria-label={`Play from ${formatClock(item.at)}: ${item.label}`}
                className="press min-h-8 cursor-pointer rounded-lg border-2 border-night-line px-2 font-mono text-xs text-mint hover:border-mint disabled:cursor-default disabled:opacity-60 disabled:hover:border-night-line"
              >
                <PlayIcon />{formatClock(item.at)}
              </button>
              <span className="text-[15px] text-cream">{item.label}</span>
              {item.detail && <span className="text-sm text-mint/90">{item.detail}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-mint">No timed events to show.</p>
      )}
    </div>
  );
}

/** The one thing to practise next, with where the advice came from. */
export function NextStep({ review, metrics, practiceHref }: {
  review: RecordingReview;
  metrics?: AnalysisMetrics;
  practiceHref: string;
}) {
  const step = buildNextStep(review, metrics);
  return (
    <section aria-labelledby="next-step-heading" className="flex w-full flex-col gap-4 rounded-2xl border-2 border-outline bg-card p-5 sm:p-7 md:flex-row md:items-center md:justify-between md:gap-8">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2 id="next-step-heading" className="font-display text-2xl font-bold text-ink">Your next practice step</h2>
        <p className="text-[17px] text-ink">{step.text}</p>
        {step.source && <p className="text-sm text-muted">{step.source}</p>}
      </div>
      <span className="shrink-0"><ButtonLink href={practiceHref}>Record another attempt →</ButtonLink></span>
    </section>
  );
}
