"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import { useParams } from "next/navigation";
import { ButtonLink } from "@/components/Button";
import { PageHeading, PageShell } from "@/components/PageHeading";
import { useDemoStore } from "@/lib/demo-store";
import { formatTake, getProject, getTake } from "@/lib/recordings";
import type { RecordingStatus } from "@/lib/types";

const stages = [
  { title: "Audio added", done: "Your recording is ready in this browser.", active: "Adding audio…", waiting: "Choose audio to begin." },
  { title: "Creating transcript", done: "Demo transcript stage finished.", active: "Simulating timestamp alignment…", waiting: "Waiting for audio" },
  { title: "Calculating scores", done: "Demo analysis stage finished.", active: "Simulating measurements…", waiting: "Waiting for transcript" },
  { title: "Preparing coaching", done: "Open your demo review when ready.", active: "Simulating coaching stage…", waiting: "Available after measurements" },
];

const finishedStages: Record<RecordingStatus, number> = {
  AWAITING_UPLOAD: 0,
  UPLOADED: 1,
  PROCESSING: 1,
  TRANSCRIBING: 2,
  ANALYZED: 3,
  COMPLETE: 4,
  FAILED: 0,
  DELETED: 0,
  PURGE_PENDING: 0,
};

const listeningGoals = [
  { label: "Pace", prompt: "Where did you give your audience time to absorb an idea?" },
  { label: "Clarity", prompt: "Which sentence made your main point easiest to understand?" },
  { label: "Confidence", prompt: "Where did your voice sound most like you?" },
];

export default function AnalyzingPage() {
  return <Suspense fallback={<PageShell><p>Loading recording…</p></PageShell>}><AnalyzingContent /></Suspense>;
}

function AnalyzingContent() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const { projects, recordings, reviews, ready } = useDemoStore();
  const [listeningGoal, setListeningGoal] = useState<number | null>(null);
  if (!ready) return <PageShell><p>Loading recording…</p></PageShell>;
  const take = getTake(recordings, recordingId);
  if (!take) return <PageShell><p>Recording not found.</p><ButtonLink href="/">All presentations</ButtonLink></PageShell>;
  const project = getProject(projects, take.project_id);
  if (!project) return <PageShell><p>Presentation not found.</p><ButtonLink href="/">All presentations</ButtonLink></PageShell>;

  const failed = take.status === "FAILED";
  const removed = take.status === "DELETED" || take.status === "PURGE_PENDING";
  const finished = finishedStages[take.status];
  const hasAnalysis = Boolean(reviews[recordingId]?.analysis);

  return (
    <PageShell>
      <PageHeading
        crumb={`${project.project_title.toUpperCase()} / ${formatTake(take.take).toUpperCase()}`}
        crumbHref={`/projects/${take.project_id}`}
        showBackArrow={false}
        title={failed ? "Analysis failed" : removed ? "Recording unavailable" : finished === 4 ? "Demo processing complete" : <>Analyzing<span className="analyzing-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></>}
        subtitle={failed ? (take.failure_reason ?? "Processing failed.") : removed ? "This recording is unavailable." : "Your audio is ready. This local preview simulates transcript and measurement stages."}
      />

      {!failed && !removed && (
        <section className="flex w-full flex-col gap-10 bg-night p-6 md:flex-row md:gap-16 md:p-12" aria-label="Analysis stages" aria-live="polite">
          <ol className="min-w-0 flex-1">
            {stages.map((stage, index) => (
              <li key={stage.title} className={`analysis-stage relative flex min-h-[100px] gap-5 border-b border-night-line p-5 ${index === finished && finished < 4 ? "analysis-stage-active" : ""}`} aria-current={index === finished && finished < 4 ? "step" : undefined}>
                <span className="w-11 shrink-0 font-mono text-[22px] text-peach">
                  {index < finished ? <span className="analysis-stage-check">✓</span> : String(index + 1).padStart(2, "0")}
                </span>
                <div className="flex flex-col gap-1.5">
                  <p className="font-display text-2xl font-bold text-cream">{stage.title}</p>
                  <p className="text-sm text-mint">{index < finished ? stage.done : index === finished ? stage.active : stage.waiting}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className={`${finished < 4 ? "pip-motion " : ""}relative h-[170px] w-[170px] shrink-0 self-center md:self-start`} aria-hidden="true">
            <Image src="/figma/pip-analyzing.svg" alt="" width={170} height={170} />
            <span className="pip-signal absolute" />
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-4">
        {finished === 4 && <ButtonLink href={`/recordings/${recordingId}`}>See results →</ButtonLink>}
        <ButtonLink variant="secondary" href={`/projects/${take.project_id}`}>Return to project</ButtonLink>
      </div>
      {!failed && !removed && (
        <p className="max-w-[1100px] text-sm text-muted">This local demo continues processing in your browser. Transcript, scores, and coaching require the AWS pipeline.</p>
      )}

      {!failed && !removed && (
        <section className="w-full max-w-[1100px] rounded-md border border-line bg-pale p-6 md:p-8" aria-labelledby="listening-goal-title">
          <p className="font-mono text-xs text-teal">WHILE YOU WAIT · OPTIONAL</p>
          <h2 id="listening-goal-title" className="mt-2 font-display text-2xl font-bold text-ink">Pick a listening goal</h2>
          <p className="mt-2 text-muted">Choose one thing to notice when you replay your recording. This is a reflection prompt, not a score.</p>
          <div className="mt-5 flex flex-wrap gap-3" role="group" aria-label="Listening goals">
            {listeningGoals.map((goal, index) => (
              <button
                key={goal.label}
                type="button"
                aria-pressed={listeningGoal === index}
                onClick={() => setListeningGoal(index)}
                className={`rounded-full border px-5 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal ${listeningGoal === index ? "border-teal bg-teal text-cream dark:border-peach dark:bg-peach dark:text-night" : "border-line bg-paper text-ink hover:border-teal"}`}
              >
                {goal.label}
              </button>
            ))}
          </div>
          {listeningGoal !== null && (
            <p className="mt-5 border-l-2 border-teal pl-4 text-ink" aria-live="polite">{listeningGoals[listeningGoal].prompt}</p>
          )}
        </section>
      )}

      {finished === 4 && !hasAnalysis && (
        <p className="max-w-[1100px] text-sm text-muted">This demo recording has no transcript or scores. Connect the AWS pipeline to generate them.</p>
      )}
    </PageShell>
  );
}
