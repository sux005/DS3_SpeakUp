import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ButtonLink } from "@/components/Button";
import { PageHeading, PageShell } from "@/components/PageHeading";
import { ProgressCharts } from "@/components/ProgressCharts";
import { RubricScore } from "@/components/RubricScore";
import { TranscriptPlayer } from "@/components/TranscriptPlayer";
import analysisJson from "@/data/demo/analysis.json";
import transcriptJson from "@/data/demo/transcript.json";
import feedbackJson from "@/data/feedback.json";
import {
  formatClock,
  formatDate,
  formatTake,
  getProject,
  getTake,
  getTakes,
  recordings,
} from "@/lib/recordings";
import { rubric } from "@/lib/rubric";
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

  // Fake data: every completed recording shows the same demo talk.
  // data/demo/ was made from public/demo/sample-take.mp3 with the backend's
  // own scorer, so the audio and transcript line up. When connected:
  //   transcript, analysis, feedback: GET /recordings/{id}/artifacts/{type}
  //   audio: GET /recordings/{id}/download returns a short-lived URL
  const metrics = analysisJson.data.metrics as AnalysisMetrics;
  const sentences = toSentences(transcriptJson.data.items as TranscriptItem[], metrics);
  const generalFeedback = feedbackJson.data.feedback;
  const audioSrc = "/demo/sample-take.mp3";

  const moments = [
    ...metrics.filler_occurrences.map((f) => ({ at: f.start_seconds, label: "filler" })),
    ...metrics.long_pauses.map((p) => ({ at: p.start_seconds, label: "pause" })),
  ].sort((a, b) => a.at - b.at);

  const values = {
    speaking_rate: `${metrics.words_per_minute} WPM`,
    filler_words: `${metrics.fillers_per_100_words} per 100 words`,
    pauses_inside_sentences: `${metrics.pauses_per_speaking_minute} per speaking-min`,
  };

  const takeLabel = formatTake(take.take).toUpperCase();

  const coaching = (
    <>
      <div className="flex flex-col gap-3 bg-night p-6">
        <p className="font-mono text-[11px] text-mint">FOR YOUR NEXT TAKE</p>
        <h2 className="font-display text-[27px] font-bold text-cream">Overall</h2>
        <p className="text-base text-cream">{generalFeedback}</p>
      </div>
      {rubric.map((metric) => {
        const score = metrics.rubric_scores[metric.key];
        return (
          <div key={metric.key} className="flex flex-col gap-2 border-l-4 border-peach bg-pale p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[19px] font-bold text-ink">{metric.title}</h3>
              <span className="font-mono text-xs text-teal">
                {score === null ? "NOT SCORED" : `${score}/4`}
              </span>
            </div>
            <p className="text-[15px] text-ink">
              {score === null
                ? "Record at least 60 seconds of speech to get a score."
                : metric.tips[score]}
            </p>
          </div>
        );
      })}
    </>
  );

  return (
    <PageShell>
      <PageHeading
        crumb={`${project.project_title.toUpperCase()} / ${takeLabel}`}
        crumbHref={`/projects/${take.project_id}`}
        title="Your Results"
        subtitle={`${formatDate(take.created_at)} · ${formatClock(metrics.duration_seconds)} · Sample results`}
      />
      <ButtonLink href={`/projects/${take.project_id}/new`}>Practice again →</ButtonLink>

      <section className="flex w-full flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-2xl font-bold text-ink">Your rubric scores</h2>
          <Link href="/rubric" className="font-mono text-xs text-teal hover:underline">
            HOW SCORING WORKS →
          </Link>
        </div>
        <div className="grid w-full gap-4 md:grid-cols-3">
          {rubric.map((metric) => (
            <div key={metric.key} className="flex flex-col gap-3 border border-line bg-cream p-6">
              <p className="font-mono text-[11px] text-muted">{metric.title.toUpperCase()}</p>
              <RubricScore score={metrics.rubric_scores[metric.key]} />
              <p className="font-display text-xl font-bold text-ink">{values[metric.key]}</p>
              <p className="text-xs text-muted">Score 4: {metric.bands[0].range}</p>
            </div>
          ))}
        </div>
      </section>

      <TranscriptPlayer
        audioSrc={audioSrc}
        sentences={sentences}
        moments={moments}
        coaching={coaching}
      />

      <hr className="w-full border-line" />
      <ProgressCharts takes={getTakes(take.project_id)} />
      <p className="text-xs text-muted">
        Demo data. Changes describe measured delivery, not an overall presentation grade.
      </p>
    </PageShell>
  );
}
