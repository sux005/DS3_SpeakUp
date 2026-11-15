"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { ButtonLink } from "@/components/Button";
import { PageHeading, PageShell } from "@/components/PageHeading";
import { MascotCoach } from "@/components/MascotCoach";
import type { MascotPose } from "@/components/Mascot";
import { RecorderUploader, type RecorderStatus } from "@/components/RecorderUploader";
import { useDemoStore } from "@/lib/demo-store";
import { getProject } from "@/lib/recordings";

// What the mascot says as the recording moves along.
const coaching: Record<RecorderStatus, { pose: MascotPose; text: string }> = {
  idle: { pose: "cheer", text: "Take a breath, then talk like you\u2019re explaining it to a friend." },
  recording: { pose: "listen", text: "I\u2019m listening. Keep going!" },
  ready: { pose: "celebrate", text: "Nice take! Give it a listen, then start the review." },
};

export default function NewAttemptPage() {
  return <Suspense fallback={<PageShell><p>Loading presentation…</p></PageShell>}><NewAttemptContent /></Suspense>;
}

function NewAttemptContent() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { projects, limits, ready, createRecording } = useDemoStore();
  const [status, setStatus] = useState<RecorderStatus>("idle");
  if (!ready) return <PageShell><p>Loading presentation…</p></PageShell>;
  const project = getProject(projects, projectId);
  if (!project) return <PageShell><p>Presentation not found.</p><ButtonLink href="/">All presentations</ButtonLink></PageShell>;

  const maxMinutes = limits.max_audio_duration_seconds / 60;
  const maxMegabytes = Math.round(limits.max_audio_upload_bytes / (1024 * 1024));

  function submit(audio: Blob, filename: string) {
    const id = createRecording(projectId, audio, filename);
    router.push(`/recordings/${id}/analyzing`);
  }

  return (
    <PageShell>
      <PageHeading
        crumb={`${project.project_title.toUpperCase()} / NEW ATTEMPT`}
        crumbHref={`/projects/${projectId}`}
        title="Record or upload"
        subtitle="Try the local recording flow. Speech scoring requires the AWS pipeline, which is not connected here."
      />

      <section data-surface="dark" className="flex w-full flex-col gap-8 rounded-3xl border-2 border-outline bg-night p-6 md:flex-row md:items-end md:gap-12 md:p-12">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <p className="font-mono text-xs text-mint">LOCAL AUDIO · DEMO MODE</p>
          <Image src="/figma/waveform-record.svg" alt="" width={960} height={110} className="h-auto w-full max-w-[960px]" />
          <RecorderUploader
            maxAudioBytes={limits.max_audio_upload_bytes}
            maxAudioDurationSeconds={limits.max_audio_duration_seconds}
            onSubmit={submit}
            onStatusChange={setStatus}
          />
        </div>
        <MascotCoach pose={coaching[status].pose}>{coaching[status].text}</MascotCoach>
      </section>

      <div className="grid w-full gap-12 md:grid-cols-2">
        <div className="flex flex-col gap-3.5">
          <h2 className="font-display text-[25px] font-bold text-ink">A quick sound check</h2>
          <p className="text-[17px] text-muted">Find a quiet space and speak naturally. You can preview or discard your recording before starting the demo flow.</p>
        </div>
        <div className="flex flex-col gap-3.5">
          <h2 className="font-display text-[25px] font-bold text-ink">Bringing a recording?</h2>
          <p className="text-[17px] text-muted">Upload WAV, MP3, M4A, or WebM audio up to {maxMegabytes} MB. Browser recording stops after {maxMinutes} minutes. Audio stays in this browser session and is not uploaded to AWS.</p>
        </div>
      </div>
    </PageShell>
  );
}
