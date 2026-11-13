"use client";

import Link from "next/link";
import { Suspense, useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { ButtonLink } from "@/components/Button";
import { PageHeading, PageShell } from "@/components/PageHeading";
import { ProgressCharts } from "@/components/ProgressCharts";
import { AudioReviewPlayer } from "@/components/AudioReviewPlayer";
import { ScoreCards } from "@/components/ScoreCards";
import { SummaryFeedback } from "@/components/SummaryFeedback";
import { SyncedTranscript } from "@/components/SyncedTranscript";
import { momentsFromAnalysis, momentsFromFeedback } from "@/lib/markers";
import { useDemoStore } from "@/lib/demo-store";
import { formatClock, formatDate, formatTake, getProject, getTake, getTakes } from "@/lib/recordings";
import { toSentences } from "@/lib/transcript";
import type { FeedbackMoment } from "@/lib/types";

export default function ResultsPage() {
  return <Suspense fallback={<PageShell><p>Loading recording…</p></PageShell>}><ResultsContent /></Suspense>;
}

function ResultsContent() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const { projects, recordings, reviews, audioUrls, ready } = useDemoStore();
  const [seekRequest, setSeekRequest] = useState<{ seconds: number }>();
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedMoment, setSelectedMoment] = useState<FeedbackMoment | undefined>();
  const [revealRequest, setRevealRequest] = useState<{ seconds: number }>();
  const [audioFailed, setAudioFailed] = useState(false);
  const handleAudioError = useCallback(() => setAudioFailed(true), []);
  if (!ready) return <PageShell><p>Loading recording…</p></PageShell>;
  const take = getTake(recordings, recordingId);
  if (!take) return <PageShell><p>Recording not found.</p><ButtonLink href="/">All presentations</ButtonLink></PageShell>;
  if (take.status !== "COMPLETE") return <PageShell><p>This recording is not ready yet.</p><ButtonLink href={`/recordings/${recordingId}/analyzing`}>View status</ButtonLink></PageShell>;
  const project = getProject(projects, take.project_id);
  if (!project) return <PageShell><p>Presentation not found.</p><ButtonLink href="/">All presentations</ButtonLink></PageShell>;

  const review = reviews[recordingId];
  const metrics = review?.analysis;
  const sentences = metrics && review ? toSentences(review.transcript.items, metrics) : [];
  const feedbackMoments = review?.feedback?.moments ?? [];
  const moments = [...momentsFromAnalysis(metrics), ...momentsFromFeedback(feedbackMoments)].sort((a, b) => a.at - b.at);
  const categories = review?.feedback?.categories;
  const takeLabel = formatTake(take.take).toUpperCase();

  return (
    <PageShell>
      <PageHeading
        crumb={`${project.project_title.toUpperCase()} / ${takeLabel}`}
        crumbHref={`/projects/${take.project_id}`}
        title={metrics ? "Your results" : "Your demo recording"}
        subtitle={`${formatDate(take.created_at)}${metrics ? ` · ${formatClock(metrics.duration_seconds)}` : ""} · Local preview`}
      />
      <ButtonLink href={`/projects/${take.project_id}/new`}>Practice again →</ButtonLink>

      {!metrics && (
        <div className="w-full rounded-md border border-line bg-pale p-6">
          <h2 className="font-display text-2xl font-bold text-ink">Analysis is not connected</h2>
          <p className="mt-2 text-muted">This recording belongs to this presentation and is available for playback during this browser session. The local demo does not generate transcript, scores, or coaching.</p>
        </div>
      )}

      <section aria-labelledby="listen-heading" data-surface="dark" className="flex w-full flex-col gap-6 rounded-md border border-night-line bg-night p-4 sm:p-6">
        <h2 id="listen-heading" className="font-display text-2xl font-bold text-cream">Listen back</h2>
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
          <div key={selectedMoment.id} className="appear border border-night-line bg-night-soft p-4 text-mint" aria-live="polite">
            <p className="font-mono text-[11px] uppercase text-peach">{selectedMoment.kind === "strength" ? "Strength" : "Try this"} · {selectedMoment.text}</p>
            <p className="mt-2 text-sm">{selectedMoment.observation}</p>
            <p className="mt-1 text-sm text-cream"><span className="font-semibold">Next step:</span> {selectedMoment.next_step}</p>
          </div>
        )}
        {review && (sentences.length > 0 ? (
          <SyncedTranscript
            sentences={sentences}
            pauses={metrics?.pauses ?? []}
            moments={feedbackMoments}
            currentTime={currentTime}
            canSeek={Boolean(audioUrls[recordingId]) && !audioFailed}
            onSeek={(seconds) => setSeekRequest({ seconds })}
            revealRequest={revealRequest}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <h3 className="font-display text-xl font-bold text-cream">Transcript</h3>
            <p className="text-mint">{review.transcript.text || "No transcript available."}</p>
          </div>
        ))}
      </section>

      {metrics && (
        <section aria-labelledby="scores-heading" className="flex w-full flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="scores-heading" className="font-display text-2xl font-bold text-ink">Your scores</h2>
            <Link href="/rubric" className="font-mono text-xs uppercase text-teal hover:underline">How scoring works →</Link>
          </div>
          <ScoreCards metrics={metrics} categories={categories} />
        </section>
      )}

      {review && (
        <SummaryFeedback
          review={review}
          metrics={metrics}
          canSeek={Boolean(audioUrls[recordingId]) && !audioFailed}
          onSeek={(seconds) => {
            setSeekRequest({ seconds });
            setRevealRequest({ seconds });
          }}
        />
      )}

      <ProgressCharts takes={getTakes(recordings, take.project_id)} />
      <p className="text-xs text-muted">Demo sample scores are shown only for the seeded recording. New local recordings have no calculated scores.</p>
    </PageShell>
  );
}
