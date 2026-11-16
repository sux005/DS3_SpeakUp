"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { ButtonLink } from "@/components/Button";
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

const columns = "md:grid-cols-[minmax(0,360px)_minmax(0,280px)_1fr_140px]";

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
  return <Suspense fallback={<PageShell><p>Loading presentation…</p></PageShell>}><ProjectContent /></Suspense>;
}

function ProjectContent() {
  const { projectId } = useParams<{ projectId: string }>();
  const { projects, recordings, ready } = useDemoStore();
  if (!ready) return <PageShell><p>Loading presentation…</p></PageShell>;
  const project = getProject(projects, projectId);
  if (!project) return <PageShell><p>Presentation not found.</p><ButtonLink href="/">All presentations</ButtonLink></PageShell>;

  const takes = getTakes(recordings, projectId);

  return (
    <PageShell>
      <PageHeading
        crumb="ALL PRESENTATIONS"
        crumbHref="/"
        title={project.project_title}
        subtitle={`${takes.length} attempts · Created ${formatDate(project.created_at, true)}`}
      />
      <ButtonLink href={`/projects/${projectId}/new`}>+ New attempt</ButtonLink>

      <ProgressCharts takes={takes} />

      <hr className="w-full border-line" />
      <h2 className="font-display text-[27px] font-bold text-ink">Your attempts</h2>

      <div className="w-full">
        <div className={`hidden gap-6 p-4 font-mono text-[11px] text-muted md:grid ${columns}`}>
          <span>ATTEMPT</span>
          <span>DATE / DURATION</span>
          <span>PACE / FILLERS / PAUSES</span>
        </div>
        <ul>
          {[...takes].reverse().map((take) => (
            <li
              key={take.recording_id}
              className={`grid items-center gap-2 border-t border-line p-4 md:gap-6 ${columns}`}
            >
              <span className="text-[19px] font-bold text-ink">{formatTake(take.take)}</span>
              <span className="text-sm text-muted">
                {formatDate(take.created_at)}
                {take.summary_metrics && ` · ${formatClock(take.summary_metrics.duration_seconds)}`}
              </span>
              <span className="font-mono text-base text-teal">
                <TakeResult take={take} />
              </span>
              <span>
                <TakeAction take={take} />
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-muted">
        Units: WPM / fillers per 100 words / pauses per speaking-minute. Shading marks the ideal
        target range for a max score.
      </p>
    </PageShell>
  );
}
