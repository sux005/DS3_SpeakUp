"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, ButtonLink } from "@/components/Button";
import { ResultsSkeleton, ReviewSkeleton } from "@/components/LoadingSkeleton";
import { MascotState } from "@/components/MascotState";
import { PageHeading, PageShell } from "@/components/PageHeading";
import { ProgressCharts } from "@/components/ProgressCharts";
import { AudioReviewPlayer } from "@/components/AudioReviewPlayer";
import { ScoreCards } from "@/components/ScoreCards";
import { EvidenceList, NextStep, Takeaway } from "@/components/ResultsSummary";
import { SyncedTranscript } from "@/components/SyncedTranscript";
import { momentsFromAnalysis, momentsFromFeedback } from "@/lib/markers";
import { useAppStore } from "@/lib/live-store";
import { formatClock, formatDate, formatTake, getProject, getTake, getTakes } from "@/lib/recordings";
import { toSentences } from "@/lib/transcript";
import type { FeedbackMoment } from "@/lib/types";

export default function ResultsPage() {
  return <Suspense fallback={<PageShell><ResultsSkeleton /></PageShell>}><ResultsContent /></Suspense>;
}

function ResultsContent() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const { projects, recordings, reviews, audioUrls, ready, live, error, refreshRecording, loadReview, loadAudio } = useAppStore();
  const [seekRequest, setSeekRequest] = useState<{ seconds: number }>();
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedMoment, setSelectedMoment] = useState<FeedbackMoment | undefined>();
  const [revealRequest, setRevealRequest] = useState<{ seconds: number }>();
  const [audioFailed, setAudioFailed] = useState(false);
  const [reviewLoadFailed, setReviewLoadFailed] = useState(false);
  const handleAudioError = useCallback(() => setAudioFailed(true), []);
  const recording = recordings.find((item) => item.recording_id === recordingId);
  const retryReview = useCallback(() => {
    setReviewLoadFailed(false);
    void loadReview(recordingId).catch(() => setReviewLoadFailed(true));
  }, [loadReview, recordingId]);

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
    return () => { cancelled = true; };
  }, [live, recordingId, refreshRecording]);

  useEffect(() => {
    if (!live || recording?.status !== "COMPLETE") return;
    void loadReview(recordingId).catch(() => setReviewLoadFailed(true));
  }, [live, recording?.status, recordingId, loadReview]);

  useEffect(() => {
    if (!live || recording?.status !== "COMPLETE") return;
    void loadAudio(recordingId).catch(() => undefined);
  }, [live, recording?.status, recordingId, loadAudio]);

  if (!ready) return <PageShell><ResultsSkeleton /></PageShell>;
  if (error && !recording) return <PageShell><p role="alert">{error}</p><ButtonLink href="/">All presentations</ButtonLink></PageShell>;
  const take = getTake(recordings, recordingId);
  if (!take) return <PageShell><MascotState message="Recording not found." detail="Nothing saved in this browser matches this link."><ButtonLink href="/">All presentations</ButtonLink></MascotState></PageShell>;
  if (take.status !== "COMPLETE") return <PageShell><MascotState tone="loading" message="This recording is not ready yet." detail="It is still being processed."><ButtonLink href={`/recordings/${recordingId}/analyzing`}>View status</ButtonLink></MascotState></PageShell>;
  const project = getProject(projects, take.project_id);
  if (!project) return <PageShell><MascotState message="Presentation not found." detail="Nothing saved in this browser matches this link."><ButtonLink href="/">All presentations</ButtonLink></MascotState></PageShell>;

  const review = reviews[recordingId];
  const metrics = review?.analysis;
  const sentences = metrics && review ? toSentences(review.transcript.items, metrics) : [];
  const feedbackMoments = review?.feedback?.moments ?? [];
  const moments = [...momentsFromAnalysis(metrics), ...momentsFromFeedback(feedbackMoments)].sort((a, b) => a.at - b.at);
  const categories = review?.feedback?.categories;
  const takeLabel = formatTake(take.take).toUpperCase();

  const canSeek = Boolean(audioUrls[recordingId]) && !audioFailed;
  const practiceHref = `/projects/${take.project_id}/new`;
  // Play from a moment and bring its sentence into view in the transcript.
  const playFrom = (seconds: number) => {
    setSeekRequest({ seconds });
    setRevealRequest({ seconds });
  };

  return (
    <PageShell>
      {/* 1. Context and the way back to practising */}
      <div className="flex w-full flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <PageHeading
          crumb={`${project.project_title.toUpperCase()} / ${takeLabel}`}
          crumbHref={`/projects/${take.project_id}`}
          title={live || metrics ? "Your results" : "Your demo recording"}
          subtitle={`${formatDate(take.created_at)}${metrics ? ` · ${formatClock(metrics.duration_seconds)}` : ""}${live ? "" : " · Local preview"}`}
        />
        <ButtonLink variant={review ? "secondary" : "primary"} href={practiceHref}>Practice again →</ButtonLink>
      </div>

      {!metrics && live && !reviewLoadFailed && <ReviewSkeleton />}
      {!metrics && (!live || reviewLoadFailed) && (
        <div className="w-full rounded-2xl border-2 border-line bg-pale p-6">
          <h2 className="font-display text-2xl font-bold text-ink">{live ? "Review could not load" : "Analysis is not connected"}</h2>
          <p className="mt-2 text-muted">{live ? "Your recording is complete, but its transcript and feedback could not be loaded." : "This recording belongs to this presentation and is available for playback during this browser session. The local demo does not generate transcript, scores, or coaching."}</p>
          {live && <Button variant="secondary" onClick={retryReview}>Retry loading review</Button>}
        </div>
      )}

      {/* 2. The takeaway: one strength, one priority */}
      {review && <Takeaway review={review} metrics={metrics} canSeek={canSeek} onSeek={playFrom} />}

      {/* 3. The three measures */}
      {metrics && (
        <section aria-labelledby="scores-heading" className="flex w-full flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="scores-heading" className="font-display text-2xl font-bold text-ink">Your scores</h2>
            <Link href="/rubric" className="nav-link text-sm font-semibold text-teal">How scoring works →</Link>
          </div>
          <ScoreCards metrics={metrics} categories={categories} />
        </section>
      )}

      {/* 4. Review: listen, replay moments and read along in one place */}
      <section aria-labelledby="listen-heading" data-surface="dark" className="flex w-full flex-col gap-6 rounded-3xl border-2 border-outline bg-night p-4 sm:p-7">
        <h2 id="listen-heading" className="font-display text-2xl font-bold text-cream">Listen back</h2>
        <div className={`grid gap-x-8 gap-y-7 ${review ? "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" : ""}`}>
          <div className="flex min-w-0 flex-col gap-6">
            <AudioReviewPlayer audioUrl={audioUrls[recordingId]} durationSeconds={metrics?.duration_seconds} seekRequest={seekRequest}
              moments={moments} onTimeChange={setCurrentTime} onLoadError={handleAudioError} onMomentSelect={(moment) => {
                setRevealRequest({ seconds: moment.at });
                if ((moment.kind === "strength" || moment.kind === "improve") && moment.observation && moment.nextStep) setSelectedMoment({
                  id: moment.id ?? `${moment.at}`,
                  start_seconds: moment.at,
                  end_seconds: moment.end ?? moment.at,
                  text: moment.text ?? moment.label,
                  kind: moment.kind,
                  observation: moment.observation,
                  next_step: moment.nextStep,
                });
              }} />
            {selectedMoment && (
              <div key={selectedMoment.id} className="appear rounded-xl border-2 border-night-line bg-night-soft p-4 text-mint" aria-live="polite">
                <p className="font-mono text-xs uppercase text-peach">{selectedMoment.kind === "strength" ? "Strength" : "Try this"} · {selectedMoment.text}</p>
                <p className="mt-2 text-[15px]">{selectedMoment.observation}</p>
                <p className="mt-1 text-[15px] text-cream"><span className="font-semibold">Next step:</span> {selectedMoment.next_step}</p>
              </div>
            )}
            {review && <EvidenceList review={review} metrics={metrics} canSeek={canSeek} onSeek={playFrom} />}
          </div>
          {review && (sentences.length > 0 ? (
            <SyncedTranscript
              sentences={sentences}
              pauses={metrics?.pauses ?? []}
              moments={feedbackMoments}
              currentTime={currentTime}
              canSeek={canSeek}
              onSeek={(seconds) => setSeekRequest({ seconds })}
              revealRequest={revealRequest}
            />
          ) : (
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="font-display text-xl font-bold text-cream">Transcript</h3>
              <p className="text-mint">{review.transcript.text || "No transcript available."}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 5. One thing to do next */}
      {review && <NextStep review={review} metrics={metrics} practiceHref={practiceHref} />}

      {/* 6. History, once there is something to compare */}
      <ProgressCharts takes={getTakes(recordings, take.project_id)} single="note" />
      {!live && <p className="text-xs text-muted">Demo sample scores are shown only for the seeded recording. New local recordings have no calculated scores.</p>}
      {error && !reviewLoadFailed && <p className="text-sm text-peach" role="alert">{error}</p>}
    </PageShell>
  );
}
