import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { ButtonLink } from "@/components/Button";
import { PageHeading, PageShell } from "@/components/PageHeading";
import { ProgressCharts } from "@/components/ProgressCharts";
import analysisJson from "@/data/analysis.json";
import feedbackJson from "@/data/feedback.json";
import transcriptJson from "@/data/transcript.json";
import {
  formatClock,
  formatDate,
  formatScore,
  formatTake,
  getProject,
  getTake,
  getTakes,
  recordings,
} from "@/lib/recordings";
import { toSentences } from "@/lib/transcript";
import type { AnalysisMetrics, TranscriptItem } from "@/lib/types";

export function generateStaticParams() {
  return recordings
    .filter((recording) => recording.status === "COMPLETE")
    .map((recording) => ({ recordingId: recording.recording_id }));
}

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ recordingId: string }>;
}) {
  const { recordingId } = await params;
  const take = getTake(recordingId);
  if (!take) notFound();
  if (take.status !== "COMPLETE") redirect(`/recordings/${recordingId}/analyzing`);
  const project = getProject(take.project_id)!;

  // Fake data: every completed recording shows the same sample artifacts.
  // When connected, fetch GET /recordings/{recordingId}/artifacts/{type}.
  const metrics = analysisJson.data.metrics as AnalysisMetrics;
  const sentences = toSentences(transcriptJson.data.items as TranscriptItem[], metrics);
  const feedback = feedbackJson.data.feedback;

  const moments = [
    ...metrics.filler_occurrences.map((f) => ({ at: f.start_seconds, label: "filler" })),
    ...metrics.long_pauses.map((p) => ({ at: p.start_seconds, label: "pause" })),
  ].sort((a, b) => a.at - b.at);

  const measurements = [
    {
      label: "PACE",
      value: `${metrics.words_per_minute} WPM`,
      score: metrics.rubric_scores.speaking_rate,
    },
    {
      label: "FILLERS",
      value: `${metrics.fillers_per_100_words} / 100 words`,
      score: metrics.rubric_scores.filler_words,
    },
    {
      label: "MID-SENTENCE PAUSES",
      value: `${metrics.pauses_per_speaking_minute} / speaking min`,
      score: metrics.rubric_scores.pauses_inside_sentences,
    },
  ];

  const takeLabel = formatTake(take.take).toUpperCase();

  return (
    <PageShell>
      <PageHeading
        crumb={`${project.project_title.toUpperCase()} / ${takeLabel}`}
        crumbHref={`/projects/${take.project_id}`}
        title="Your Results"
        subtitle={`${formatDate(take.created_at)} · ${formatClock(metrics.duration_seconds)} · Sample results`}
      />
      <ButtonLink href={`/projects/${take.project_id}/new`}>Practice again →</ButtonLink>

      <div className="grid w-full md:grid-cols-3">
        {measurements.map((m) => (
          <div key={m.label} className="flex flex-col gap-2 p-6">
            <p className="font-mono text-[11px] text-muted">{m.label}</p>
            <p className="font-display text-[28px] font-bold text-ink">{m.value}</p>
            <p className="text-xs text-teal">{formatScore(m.score)}</p>
          </div>
        ))}
      </div>

      <hr className="w-full border-line" />

      <section className="flex w-full flex-col gap-3.5 bg-night p-6">
        <p className="whitespace-pre-wrap font-mono text-base text-cream">
          {`▶   00:00 / ${formatClock(metrics.duration_seconds)}          ${takeLabel} / 1×`}
        </p>
        <Image
          src="/figma/waveform-playback.svg"
          alt=""
          width={1264}
          height={76}
          className="h-auto w-full"
        />
        <p className="flex flex-wrap gap-x-10 font-mono text-[11px] text-peach">
          {moments.map((moment) => (
            <span key={`${moment.label}-${moment.at}`}>
              {formatClock(moment.at)} · {moment.label}
            </span>
          ))}
        </p>
      </section>

      <div className="flex w-full flex-col gap-10 md:flex-row">
        <section className="flex min-w-0 flex-1 flex-col gap-4">
          <h2 className="font-display text-2xl font-bold text-ink">The transcript</h2>
          <p className="whitespace-pre-wrap font-mono text-[11px] text-teal">
            {"ALL MOMENTS    /    FILLERS    /    PAUSES    /    PACE"}
          </p>
          <ul>
            {sentences.map((sentence) => (
              <li
                key={sentence.start}
                className="flex flex-col gap-1 border-t border-line py-4 sm:flex-row sm:gap-5"
              >
                <span className="w-36 shrink-0 font-mono text-[11px] text-rust">
                  {formatClock(sentence.start)}
                  {sentence.tag && ` · ${sentence.tag}`}
                </span>
                <span className="text-[17px] text-ink">{sentence.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <aside className="flex w-full flex-col gap-4 bg-pale p-6 md:w-[440px]">
          <p className="font-mono text-[11px] text-teal">FOR YOUR NEXT TAKE</p>
          <h2 className="font-display text-[27px] font-bold text-ink">Supercool suggestion</h2>
          <p className="text-base text-ink">{feedback}</p>
        </aside>
      </div>

      <hr className="w-full border-line" />
      <ProgressCharts takes={getTakes(take.project_id)} />
      <p className="text-xs text-muted">
        Demo data. Changes describe measured delivery, not an overall presentation grade.
      </p>
    </PageShell>
  );
}
