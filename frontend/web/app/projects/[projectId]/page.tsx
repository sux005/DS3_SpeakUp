"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { ButtonLink } from "@/components/Button";
import { MascotState } from "@/components/MascotState";
import { PageHeading, PageShell } from "@/components/PageHeading";
import { ProgressCharts } from "@/components/ProgressCharts";
import { useDemoStore } from "@/lib/demo-store";
import {
  formatClock,
  formatDate,
  formatTake,
  getProject,
  getTakes,
} from "@/lib/recordings";
import type { Take } from "@/lib/types";

const columns = "md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_132px]";

function TakeResult({ take }: { take: Take }) {
  const m = take.summary_metrics;
  if (m) {
    return `${m.words_per_minute} / ${m.fillers_per_100_words} / ${m.pauses_per_speaking_minute}`;
  }
  if (take.status === "COMPLETE") return "Local demo · no scores";
  if (take.status === "FAILED") return take.failure_reason ?? "Failed";
  return "Processing…";
}

function TakeAction({ take }: { take: Take }) {
  if (take.status === "COMPLETE") {
    return (
      <ButtonLink variant="secondary" href={`/recordings/${take.recording_id}`}>
        Review →
      </ButtonLink>
    );
  }
  if (take.status === "FAILED") return null;
  return (
    <ButtonLink variant="secondary" href={`/recordings/${take.recording_id}/analyzing`}>
      Status →
    </ButtonLink>
  );
}

export default function ProjectPage() {
  return <Suspense fallback={<PageShell><MascotState busy pose="think" message="Loading presentation…" /></PageShell>}><ProjectContent /></Suspense>;
}

function ProjectContent() {
  const { projectId } = useParams<{ projectId: string }>();
  const { projects, recordings, ready } = useDemoStore();
  if (!ready) return <PageShell><MascotState busy pose="think" message="Loading presentation…" /></PageShell>;
  const project = getProject(projects, projectId);
  if (!project) return <PageShell><MascotState pose="oops" message="Presentation not found." detail="Nothing saved in this browser matches this link."><ButtonLink href="/">All presentations</ButtonLink></MascotState></PageShell>;

  const takes = getTakes(recordings, projectId);
  const hasScores = takes.some((take) => take.summary_metrics);

  return (
    <PageShell>
      <div className="flex w-full flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <PageHeading
          crumb="ALL PRESENTATIONS"
          crumbHref="/"
          title={project.project_title}
          subtitle={`${takes.length} ${takes.length === 1 ? "attempt" : "attempts"} · Created ${formatDate(project.created_at, true)}`}
        />
        <ButtonLink href={`/projects/${projectId}/new`}>+ New attempt</ButtonLink>
      </div>

      {/* Scores and attempts share one surface: they are the same workspace. */}
      <div className="w-full overflow-hidden rounded-2xl border-2 border-line bg-card">
        {hasScores && (
          <div className="border-b-2 border-line p-5 md:p-7">
            <ProgressCharts takes={takes} />
          </div>
        )}
        <div className="flex flex-col">
          <h2 className="px-5 pt-5 font-display text-2xl font-bold text-ink md:px-7 md:pt-6">Your attempts</h2>
          <div className={`label hidden gap-6 px-5 pt-4 pb-2 md:grid md:px-7 ${columns}`}>
            <span>Attempt</span>
            <span>Date / duration</span>
            <span>Pace / fillers / pauses</span>
          </div>
          <ul className="pt-2 md:pt-0">
            {[...takes].reverse().map((take) => (
              <li
                key={take.recording_id}
                className={`grid items-center gap-1.5 border-t-2 border-line px-5 py-4 md:gap-6 md:px-7 ${columns}`}
              >
                <span className="text-lg font-bold text-ink">{formatTake(take.take)}</span>
                <span className="text-[15px] text-muted">
                  {formatDate(take.created_at)}
                  {take.summary_metrics && ` · ${formatClock(take.summary_metrics.duration_seconds)}`}
                </span>
                <span className={`font-mono text-base ${take.status === "FAILED" ? "text-rust" : "text-teal"}`}>
                  <TakeResult take={take} />
                </span>
                <span className="mt-1.5 md:mt-0">
                  <TakeAction take={take} />
                </span>
              </li>
            ))}
            {takes.length === 0 && <li className="border-t-2 border-line px-5 py-5 text-muted md:px-7">No attempts yet. Choose New attempt to record or upload one.</li>}
          </ul>
        </div>
      </div>

      <p className="text-sm text-muted">
        Units: WPM / fillers per 100 words / pauses per speaking-minute.{hasScores && " Shading marks the target range for a score of 4."}
      </p>
    </PageShell>
  );
}
