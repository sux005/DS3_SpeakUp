"use client";

import { Suspense, useState } from "react";
import { useParams } from "next/navigation";
import { ButtonLink } from "@/components/Button";
import { PageHeading, PageShell } from "@/components/PageHeading";
import { ProgressCharts } from "@/components/ProgressCharts";
import { AudioReviewPlayer } from "@/components/AudioReviewPlayer";
import { useDemoStore } from "@/lib/demo-store";
import { formatClock, formatDate, formatScore, formatTake, getProject, getTake, getTakes } from "@/lib/recordings";
import { toSentences } from "@/lib/transcript";
import type { FeedbackCategory, FeedbackMoment } from "@/lib/types";

export default function ResultsPage() {
  return <Suspense fallback={<PageShell><p>Loading recording…</p></PageShell>}><ResultsContent /></Suspense>;
}

function ResultsContent() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const { projects, recordings, reviews, audioUrls, ready } = useDemoStore();
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedMoment, setSelectedMoment] = useState<FeedbackMoment | undefined>();
  if (!ready) return <PageShell><p>Loading recording…</p></PageShell>;
  const take = getTake(recordings, recordingId);
  if (!take) return <PageShell><p>Recording not found.</p><ButtonLink href="/">All presentations</ButtonLink></PageShell>;
  if (take.status !== "COMPLETE") return <PageShell><p>This recording is not ready yet.</p><ButtonLink href={`/recordings/${recordingId}/analyzing`}>View status</ButtonLink></PageShell>;
  const project = getProject(projects, take.project_id);
  if (!project) return <PageShell><p>Presentation not found.</p><ButtonLink href="/">All presentations</ButtonLink></PageShell>;

  const review = reviews[recordingId];
  const metrics = review?.analysis;
  const sentences = metrics && review ? toSentences(review.transcript.items, metrics) : [];
  const words = review?.transcript.items.flatMap((item, index) => {
    const text = item.alternatives[0]?.content;
    if (!text || item.type !== "pronunciation" || item.start_time === undefined) return [];
    return [{ id: `${index}-${text}`, text, start: Number(item.start_time), end: Number(item.end_time ?? item.start_time) }];
  }) ?? [];
  const feedbackMoments = review?.feedback?.moments ?? [];
  const moments = feedbackMoments.length > 0
    ? feedbackMoments.map((moment) => ({
      id: moment.id,
      at: moment.start_seconds,
      end: moment.end_seconds,
      label: moment.kind === "strength" ? "Strength" : "Try this",
      text: moment.text,
      kind: moment.kind,
      observation: moment.observation,
      nextStep: moment.next_step,
    }))
    : metrics ? [
      ...metrics.filler_occurrences.map((f, index) => ({ id: `filler-${index}`, at: f.start_seconds, end: f.end_seconds, label: `Filler: ${f.filler}` })),
      ...metrics.long_pauses.map((p, index) => ({ id: `pause-${index}`, at: p.start_seconds, end: p.end_seconds, label: "Long pause" })),
    ].sort((a, b) => a.at - b.at) : [];
  const categories = review?.feedback?.categories;
  const categoryLabels: [keyof NonNullable<typeof categories>, string][] = [
    ["general", "General speech"], ["pace", "Pace"], ["fillers", "Filler words"], ["pauses", "Pauses"],
  ];
  const categoryMeasurements = metrics ? {
    pace: `${metrics.words_per_minute} WPM`,
    fillers: `${metrics.fillers_per_100_words} fillers / 100 words`,
    pauses: `${metrics.pauses_per_speaking_minute} pauses / speaking min`,
  } : null;
  const takeLabel = formatTake(take.take).toUpperCase();
  const measurements = metrics ? [
    { label: "PACE", value: `${metrics.words_per_minute} WPM`, score: metrics.rubric_scores.speaking_rate },
    { label: "FILLERS", value: `${metrics.fillers_per_100_words} / 100 words`, score: metrics.rubric_scores.filler_words },
    { label: "MID-SENTENCE PAUSES", value: `${metrics.pauses_per_speaking_minute} / speaking min`, score: metrics.rubric_scores.pauses_inside_sentences },
  ] : [];

  return (
    <PageShell>
      <PageHeading
        crumb={`${project.project_title.toUpperCase()} / ${takeLabel}`}
        crumbHref={`/projects/${take.project_id}`}
        title={metrics ? "Your results" : "Your demo recording"}
        subtitle={`${formatDate(take.created_at)}${metrics ? ` · ${formatClock(metrics.duration_seconds)}` : ""} · Local preview`}
      />
      <ButtonLink href={`/projects/${take.project_id}/new`}>Practice again →</ButtonLink>

      {metrics ? (
        <div className="grid w-full md:grid-cols-3">
          {measurements.map((measurement) => (
            <div key={measurement.label} className="flex flex-col gap-2 p-6">
              <p className="font-mono text-[11px] text-muted">{measurement.label}</p>
              <p className="font-display text-[28px] font-bold text-ink">{measurement.value}</p>
              <p className="text-xs text-teal">{formatScore(measurement.score)}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="w-full rounded-md border border-line bg-pale p-6">
          <h2 className="font-display text-2xl font-bold text-ink">Analysis is not connected</h2>
          <p className="mt-2 text-muted">This recording belongs to this presentation and is available for playback during this browser session. The local demo does not generate transcript, scores, or coaching.</p>
        </div>
      )}

      <section className="flex w-full flex-col gap-4 bg-night p-6">
        <h2 className="font-display text-2xl font-bold text-cream">Recording playback</h2>
        <AudioReviewPlayer audioUrl={audioUrls[recordingId]} durationSeconds={metrics?.duration_seconds}
          moments={moments} onTimeChange={setCurrentTime} onMomentSelect={(moment) => {
            if (moment.observation && moment.nextStep) setSelectedMoment({
              id: moment.id ?? `${moment.at}`,
              start_seconds: moment.at,
              end_seconds: moment.end ?? moment.at,
              text: moment.text ?? moment.label,
              kind: moment.kind ?? "improve",
              observation: moment.observation,
              next_step: moment.nextStep,
            });
          }} />
        {selectedMoment && (
          <div className="border border-night-line bg-night-soft p-4 text-mint" aria-live="polite">
            <p className="font-mono text-[11px] uppercase text-peach">{selectedMoment.kind === "strength" ? "Strength" : "Try this"} · {selectedMoment.text}</p>
            <p className="mt-2 text-sm">{selectedMoment.observation}</p>
            <p className="mt-1 text-sm text-cream"><span className="font-semibold">Next step:</span> {selectedMoment.next_step}</p>
          </div>
        )}
      </section>

      {review && (
        <div className="flex w-full flex-col gap-10 md:flex-row">
          <section className="flex min-w-0 flex-1 flex-col gap-4">
            <h2 className="font-display text-2xl font-bold text-ink">The transcript</h2>
            {sentences.length > 0 ? (
              <ul>
                {sentences.map((sentence) => (
                  <li key={sentence.start} className={`flex flex-col gap-1 border-t border-line py-4 sm:flex-row sm:gap-5 ${audioUrls[recordingId] && currentTime >= sentence.start && currentTime <= sentence.end ? "bg-pale" : ""}`}>
                    <span className="w-36 shrink-0 font-mono text-[11px] text-rust">
                      {formatClock(sentence.start)}{sentence.tag && ` · ${sentence.tag}`}
                    </span>
                    <span className="text-[17px] text-ink">
                      {words.filter((word) => word.start >= sentence.start && word.start <= sentence.end).map((word) => {
                        const active = currentTime >= word.start && currentTime <= word.end;
                        const marked = feedbackMoments.some((moment) => word.start >= moment.start_seconds && word.start <= moment.end_seconds);
                        return <span key={word.id} className={`mr-1 rounded-sm transition-colors ${active ? "bg-peach px-0.5" : marked ? "bg-pale underline decoration-rust decoration-2 underline-offset-4" : ""}`}>{word.text}</span>;
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-muted">{review.transcript.text || "No transcript available."}</p>}
          </section>
          <aside className="flex w-full flex-col gap-4 bg-pale p-6 md:w-[440px]">
            <p className="font-mono text-[11px] text-teal">FOR YOUR NEXT TAKE</p>
            <h2 className="font-display text-[27px] font-bold text-ink">Coaching</h2>
            <p className="text-base text-ink">{review.feedback?.feedback ?? "Coaching is not available for this recording."}</p>
            {categories ? (
              <div className="flex flex-col gap-4">
                {categoryLabels.map(([key, label]) => {
                  const category = categories[key] as FeedbackCategory | undefined;
                  if (!category) return null;
                  const measurement = key === "general" ? null : categoryMeasurements?.[key];
                  return <article key={key} className="border-t border-line pt-3"><p className="font-mono text-[11px] text-teal">{label}</p>{measurement && <p className="mt-1 text-sm font-semibold text-teal">{measurement}</p>}<p className="mt-1 text-sm text-ink">{category.observation}</p><p className="mt-1 text-sm text-ink"><span className="font-semibold">Next step:</span> {category.next_step}</p></article>;
                })}
              </div>
            ) : null}
          </aside>
        </div>
      )}

      <ProgressCharts takes={getTakes(recordings, take.project_id)} />
      <p className="text-xs text-muted">Demo sample scores are shown only for the seeded recording. New local recordings have no calculated scores.</p>
    </PageShell>
  );
}
