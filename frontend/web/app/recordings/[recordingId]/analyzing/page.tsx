import Image from "next/image";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/Button";
import { PageHeading, PageShell } from "@/components/PageHeading";
import { formatTake, getProject, getTake, recordings } from "@/lib/recordings";

export function generateStaticParams() {
  return recordings.map((recording) => ({ recordingId: recording.recording_id }));
}

const stages = [
  { title: "Audio uploaded", done: "Your recording was received.", waiting: "" },
  {
    title: "Creating transcript",
    done: "Transcript ready",
    waiting: "In progress · aligning speech with timestamps",
  },
  { title: "Calculating scores", done: "Scores ready", waiting: "Waiting for transcript" },
  { title: "Preparing coaching", done: "Coaching ready", waiting: "Available after measurements" },
];

// How many stages are finished for each backend status. The backend has no
// separate status for scoring or coaching, so those finish at COMPLETE.
const finishedStages: Record<string, number> = {
  AWAITING_UPLOAD: 0,
  UPLOADED: 1,
  PROCESSING: 1,
  TRANSCRIBING: 1,
  COMPLETE: 4,
};

export default async function AnalyzingPage({
  params,
}: {
  params: Promise<{ recordingId: string }>;
}) {
  const { recordingId } = await params;
  const take = getTake(recordingId);
  if (!take) notFound();
  const project = getProject(take.project_id)!;

  // Fake data, so the status never changes. When connected, poll
  // GET /recordings/{recordingId} until COMPLETE or FAILED.
  const failed = take.status === "FAILED";
  const finished = finishedStages[take.status] ?? 0;

  return (
    <PageShell>
      <PageHeading
        crumb={`${project.project_title.toUpperCase()} / ${formatTake(take.take).toUpperCase()}`}
        title={failed ? "Analysis failed" : finished === 4 ? "Analysis complete" : "Analyzing..."}
        subtitle={
          failed
            ? (take.failure_reason ?? "Something went wrong. Try recording again.")
            : "Your audio has uploaded. We’re preparing the transcript and measurements."
        }
      />

      {!failed && (
        <section className="flex w-full flex-col gap-10 bg-night p-6 md:flex-row md:gap-16 md:p-12">
          <ol className="min-w-0 flex-1">
            {stages.map((stage, i) => (
              <li key={stage.title} className="flex gap-5 border-b border-night-line p-5">
                <span className="w-11 shrink-0 font-mono text-[22px] text-peach">
                  {i < finished ? "✓" : String(i + 1).padStart(2, "0")}
                </span>
                <div className="flex flex-col gap-1.5">
                  <p className="font-display text-2xl font-bold text-cream">{stage.title}</p>
                  <p className="text-sm text-mint">{i < finished ? stage.done : stage.waiting}</p>
                </div>
              </li>
            ))}
          </ol>
          <Image src="/figma/pip-analyzing.svg" alt="" width={170} height={170} className="shrink-0" />
        </section>
      )}

      <div className="flex flex-wrap gap-4">
        {finished === 4 && <ButtonLink href={`/recordings/${recordingId}`}>See results →</ButtonLink>}
        <ButtonLink variant="secondary" href={`/projects/${take.project_id}`}>
          Return to project
        </ButtonLink>
      </div>
      <p className="max-w-[1100px] text-sm text-muted">
        Once upload is complete, processing continues independently. If coaching is delayed, your
        scores and transcript can still appear.
      </p>
    </PageShell>
  );
}
