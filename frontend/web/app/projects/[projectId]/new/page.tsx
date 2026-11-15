"use client";

import { Suspense, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ButtonLink } from "@/components/Button";
import { MascotState } from "@/components/MascotState";
import { PageHeading, PageShell } from "@/components/PageHeading";
import { MascotCoach } from "@/components/MascotCoach";
import { RecorderUploader, type RecorderStatus } from "@/components/RecorderUploader";
import { useDemoStore } from "@/lib/demo-store";
import { getProject } from "@/lib/recordings";

// What the mascot's bubble says. While recording it says nothing: the red
// indicator and timer beside the controls already carry that state.
const bubble: Record<RecorderStatus, string | null> = {
  idle: "Ready to record.",
  recording: null,
  ready: "Have a listen before you start the review.",
};

export default function NewAttemptPage() {
  return <Suspense fallback={<PageShell><MascotState busy message="Loading presentation…" /></PageShell>}><NewAttemptContent /></Suspense>;
}

function NewAttemptContent() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { projects, limits, ready, createRecording } = useDemoStore();
  const [status, setStatus] = useState<RecorderStatus>("idle");
  if (!ready) return <PageShell><MascotState busy message="Loading presentation…" /></PageShell>;
  const project = getProject(projects, projectId);
  if (!project) return <PageShell><MascotState message="Presentation not found." detail="Nothing saved in this browser matches this link."><ButtonLink href="/">All presentations</ButtonLink></MascotState></PageShell>;

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

      <section data-surface="dark" className="flex w-full flex-col gap-8 rounded-3xl border-2 border-outline bg-night p-6 md:flex-row md:items-end md:gap-10 md:p-10">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <h2 className="font-display text-2xl font-bold text-cream">Add your audio</h2>
            <p className="max-w-xl text-cream/85">Find a quiet space and speak naturally. You can preview or discard your audio before starting the demo review.</p>
          </div>
          <RecorderUploader
            maxAudioBytes={limits.max_audio_upload_bytes}
            maxAudioDurationSeconds={limits.max_audio_duration_seconds}
            onSubmit={submit}
            onStatusChange={setStatus}
          />
        </div>
        <MascotCoach state="recording">{bubble[status]}</MascotCoach>
      </section>

      <p className="text-sm text-muted">Audio stays in this browser session and is not uploaded to AWS.</p>
    </PageShell>
  );
}
