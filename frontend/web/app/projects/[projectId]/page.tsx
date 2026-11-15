"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { ButtonLink } from "@/components/Button";
import { MascotState } from "@/components/MascotState";
import { PageHeading, PageShell } from "@/components/PageHeading";
import { ProgressCharts } from "@/components/ProgressCharts";
import { StrataDivider } from "@/components/Scenery";
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
  return <Suspense fallback={<PageShell><MascotState busy pose="think" message="Loading presentation…" /></PageShell>}><ProjectContent /></Suspense>;
}

function ProjectContent() {
  const { projectId } = useParams<{ projectId: string }>();
  const { projects, recordings, ready } = useDemoStore();
  if (!ready) return <PageShell><MascotState busy pose="think" message="Loading presentation…" /></PageShell>;
  const project = getProject(projects, projectId);
  if (!project) return <PageShell><MascotState pose="oops" message="Presentation not found." detail="Nothing saved in this browser matches this link."><ButtonLink href="/">All presentations</ButtonLink></MascotState></PageShell>;

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

      <StrataDivider />
      <h2 className="font-display text-[27px] font-bold text-ink">Your attempts</h2>

      <div className="w-full overflow-hidden rounded-2xl border-2 border-line bg-card">
        <div className={`hidden gap-6 px-5 py-3 font-mono text-[11px] text-muted md:grid ${columns}`}>
          <span>ATTEMPT</span>
          <span>DATE / DURATION</span>
          <span>PACE / FILLERS / PAUSES</span>
        </div>
        <ul>
          {[...takes].reverse().map((take) => (
            <li
              key={take.recording_id}
              className={`grid items-center gap-2 border-t-2 border-line p-5 first:border-t-0 md:gap-6 md:first:border-t-2 ${columns}`}
            >
              <span className="text-[19px] font-bold text-ink">{formatTake(take.take)}</span>
              <span className="text-sm text-muted">
                {formatDate(take.created_at)}
                {take.summary_metrics && ` · ${formatClock(take.summary_metrics.duration_seconds)}`}
              </span>
              <span className={`font-mono text-base ${take.status === "FAILED" ? "text-rust" : "text-teal"}`}>
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
