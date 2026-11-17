"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ButtonLink } from "@/components/Button";
import { AnalyzingSkeleton } from "@/components/LoadingSkeleton";
import { Mascot } from "@/components/Mascot";
import { MascotState } from "@/components/MascotState";
import { PageHeading, PageShell } from "@/components/PageHeading";
import { useAppStore } from "@/lib/live-store";
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

const terminalStatuses = new Set<RecordingStatus>(["COMPLETE", "FAILED", "DELETED", "PURGE_PENDING"]);

export default function AnalyzingPage() {
  return <Suspense fallback={<PageShell><AnalyzingSkeleton /></PageShell>}><AnalyzingContent /></Suspense>;
}

function AnalyzingContent() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const { projects, recordings, reviews, ready, live, error, refreshRecording, loadReview, loadAudio } = useAppStore();
  const [listeningGoal, setListeningGoal] = useState<number | null>(null);
  const recording = recordings.find((item) => item.recording_id === recordingId);
  const recordingStatus = recording?.status;

  useEffect(() => {
    if (!live || !recordingId) return;
    let cancelled = false;
    const refresh = async () => {
      if (!cancelled) {
        try {
          await refreshRecording(recordingId);
        } catch {
          // The store records provider errors for the page to display.
        }
      }
    };
    void refresh();
    const interval = recordingStatus && terminalStatuses.has(recordingStatus)
      ? undefined
      : window.setInterval(() => void refresh(), 2_000);
    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, [live, recordingStatus, recordingId, refreshRecording]);

  useEffect(() => {
    if (!live || recording?.status !== "COMPLETE") return;
    void loadReview(recordingId).catch(() => undefined);
    void loadAudio(recordingId).catch(() => undefined);
  }, [live, recording?.status, recordingId, loadReview, loadAudio]);

  if (!ready) return <PageShell><AnalyzingSkeleton /></PageShell>;
  if (error && !recording) return <PageShell><p role="alert">{error}</p><ButtonLink href="/">All presentations</ButtonLink></PageShell>;
  const take = getTake(recordings, recordingId);
  if (!take) return <PageShell><MascotState message="Recording not found." detail="Nothing saved in this browser matches this link."><ButtonLink href="/">All presentations</ButtonLink></MascotState></PageShell>;
  const project = getProject(projects, take.project_id);
  if (!project) return <PageShell><MascotState message="Presentation not found." detail="Nothing saved in this browser matches this link."><ButtonLink href="/">All presentations</ButtonLink></MascotState></PageShell>;

  const failed = take.status === "FAILED";
  const removed = take.status === "DELETED" || take.status === "PURGE_PENDING";
  const finished = finishedStages[take.status];
  const hasAnalysis = Boolean(reviews[recordingId]?.analysis);
  const processingSubtitle = live
    ? "Your recording is being processed. This page will update automatically."
    : "Your audio is ready. This local preview simulates transcript and measurement stages.";
  const completionTitle = live ? "Analysis ready" : "Demo processing complete";

  return (
    <PageShell>
      <PageHeading
        crumb={`${project.project_title.toUpperCase()} / ${formatTake(take.take).toUpperCase()}`}
        crumbHref={`/projects/${take.project_id}`}
        showBackArrow={false}
        title={failed ? "Analysis failed" : removed ? "Recording unavailable" : finished === 4 ? completionTitle : <>Analyzing<span className="analyzing-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></>}
        subtitle={failed ? (take.failure_reason ?? "Processing failed.") : removed ? "This recording is unavailable." : processingSubtitle}
      />

      {!failed && !removed && (
        <section data-surface="dark" className="flex w-full flex-col gap-8 rounded-3xl border-2 border-outline bg-night p-4 sm:p-6 md:flex-row md:gap-12 md:p-12" aria-label="Analysis stages" aria-live="polite">
          <ol className="min-w-0 flex-1">
            {stages.map((stage, index) => (
              <li key={stage.title} className={`analysis-stage relative flex min-h-[100px] items-start gap-5 border-b border-night-line p-4 last:border-b-0 sm:p-5 ${index === finished && finished < 4 ? "analysis-stage-active" : ""}`} aria-current={index === finished && finished < 4 ? "step" : undefined}>
                <span className={`egg-badge ${index > finished ? "opacity-55" : ""}`}>
                  {index < finished ? <span className="analysis-stage-check">✓</span> : index + 1}
                </span>
                <div className="flex flex-col gap-1.5">
                  <p className="font-display text-2xl font-bold text-cream">{stage.title}</p>
                <p className="text-sm text-mint">{index < finished ? (live ? "Stage complete." : stage.done) : index === finished ? (live ? "Processing…" : stage.active) : (live ? "Waiting for previous stage" : stage.waiting)}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className={`${finished < 4 ? "mascot-float " : ""}shrink-0 self-center`} aria-hidden="true">
            <Mascot state={finished === 4 && hasAnalysis ? "results" : "neutral"} flip className="w-28 md:w-40" />
          </div>
        </section>
      )}

      {(failed || removed) && (
        <MascotState
          tone={failed ? "error" : "plain"}
          message={failed ? "This take didn’t make it through." : "This recording is no longer here."}
          detail={failed ? "Nothing was scored. Record or upload another attempt to try again." : "It was removed, so there is nothing to play or review."}
        >
          {failed && <ButtonLink href={`/projects/${take.project_id}/new`}>Try another attempt</ButtonLink>}
        </MascotState>
      )}

      <div className="flex flex-wrap gap-4">
        {finished === 4 && <ButtonLink href={`/recordings/${recordingId}`}>See results →</ButtonLink>}
        <ButtonLink variant="secondary" href={`/projects/${take.project_id}`}>Return to project</ButtonLink>
      </div>
      {!failed && !removed && !live && (
        <p className="max-w-[1100px] text-sm text-muted">This local demo continues processing in your browser. Transcript, scores, and coaching require the AWS pipeline.</p>
      )}

      {!failed && !removed && (
        <section className="w-full max-w-[1100px] rounded-2xl border-2 border-line bg-pale p-6 md:p-8" aria-labelledby="listening-goal-title">
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
                className={`min-h-11 cursor-pointer rounded-full border-2 px-5 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet ${listeningGoal === index ? "border-violet bg-violet text-cream dark:text-night" : "border-line bg-card text-ink hover:border-teal"}`}
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

      {finished === 4 && !hasAnalysis && !live && (
        <p className="max-w-[1100px] text-sm text-muted">This demo recording has no transcript or scores. Connect the AWS pipeline to generate them.</p>
      )}
      {error && <p className="max-w-[1100px] text-sm text-peach" role="alert">{error}</p>}
    </PageShell>
  );
}
