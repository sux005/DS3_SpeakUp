import Image from "next/image";
import { notFound } from "next/navigation";
import { Button, buttonClass } from "@/components/Button";
import { PageHeading, PageShell } from "@/components/PageHeading";
import limits from "@/data/account-limits.json";
import { getProject, projects } from "@/lib/recordings";

export function generateStaticParams() {
  return projects.map((project) => ({ projectId: project.project_id }));
}

export default async function NewAttemptPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = getProject(projectId);
  if (!project) notFound();

  const maxMinutes = limits.max_audio_duration_seconds / 60;
  const maxMegabytes = Math.round(limits.max_audio_upload_bytes / (1024 * 1024));

  // Recording and uploading aren't connected yet. The upload flow is
  // POST /uploads, then PUT the file, then poll the recording's status
  // (see frontend/sample-payloads/README.md).
  return (
    <PageShell>
      <PageHeading
        crumb={`${project.project_title.toUpperCase()} / NEW ATTEMPT`}
        crumbHref={`/projects/${projectId}`}
        title="Record or Upload"
        subtitle="Record here or upload audio. Include at least one minute of speech for scoring."
      />

      <div className="flex flex-wrap gap-4">
        <Button>● Record audio</Button>
        <label className={buttonClass("secondary")}>
          ↑ Upload audio
          <input type="file" accept=".wav,.mp3,.m4a" className="sr-only" />
        </label>
      </div>

      <section className="flex w-full flex-col gap-10 bg-night p-6 md:flex-row md:p-12">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <p className="font-mono text-xs text-mint">MICROPHONE READY · DEFAULT INPUT</p>
          <p className="font-display text-6xl font-bold text-cream md:text-[86px]">00:00</p>
          <Image
            src="/figma/waveform-record.svg"
            alt=""
            width={960}
            height={110}
            className="h-auto w-full max-w-[960px]"
          />
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="accent">● Start recording</Button>
            <p className="text-sm text-mint">Check your microphone before starting.</p>
          </div>
        </div>
        <Image src="/figma/pip-record.svg" alt="" width={188} height={188} className="shrink-0" />
      </section>

      <div className="grid w-full gap-12 md:grid-cols-2">
        <div className="flex flex-col gap-3.5">
          <h2 className="font-display text-[25px] font-bold text-ink">A quick sound check</h2>
          <p className="text-[17px] text-muted">
            Find a quiet space. Speak naturally. You can listen back and record again before
            analyzing.
          </p>
        </div>
        <div className="flex flex-col gap-3.5">
          <h2 className="font-display text-[25px] font-bold text-ink">Bringing a recording?</h2>
          <p className="text-[17px] text-muted">
            WAV, MP3, or M4A, up to {maxMinutes} minutes and {maxMegabytes} MB. Audio is uploaded
            for analysis after you choose Analyze. Video is outside this MVP.
          </p>
        </div>
      </div>

      <hr className="w-full border-line" />
      <p className="text-[13px] text-muted">
        Your audio is private. Delete an attempt to remove its recording and results. Retention
        policy: whatever ends up being decided
      </p>
    </PageShell>
  );
}
