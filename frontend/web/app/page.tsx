"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { PageShell } from "@/components/PageHeading";
import { Button, ButtonLink } from "@/components/Button";
import { RecorderUploader } from "@/components/RecorderUploader";
import { useDemoStore } from "@/lib/demo-store";
import { getTakes } from "@/lib/recordings";

export default function Home() {
  const router = useRouter();
  const { projects, recordings, createProject, createRecording, limits, ready } = useDemoStore();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  function startPresentation(audio: Blob, filename: string) {
    if (!ready) return;
    const name = title.trim() || `Presentation ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date())}`;
    const projectId = createProject(name, "");
    const recordingId = createRecording(projectId, audio, filename);
    router.push(`/recordings/${recordingId}/analyzing`);
  }

  return (
    <PageShell>
      <section className="flex w-full flex-col gap-8 bg-night p-9 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col items-start gap-4">
          <p className="font-mono text-xs text-mint">YOUR PRACTICE SPACE · LOCAL DEMO</p>
          <h1 className="font-display text-4xl font-bold text-cream md:text-5xl">Practice your next presentation</h1>
          <p className="text-[17px] text-mint">Keep your recordings, feedback, and progress together.</p>
          <Button variant="accent" disabled={!ready} aria-expanded={creating} aria-controls="new-presentation" onClick={() => setCreating((value) => !value)}>
            {creating ? "Cancel" : "+ New presentation"}
          </Button>
        </div>
        <Image src="/figma/pip-home.svg" alt="" width={176} height={176} />
      </section>

      {creating && (
        <section id="new-presentation" className="flex w-full flex-col gap-5 rounded-md border border-line bg-pale p-6">
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">Start with your audio</h2>
            <p className="mt-2 text-sm text-muted">Upload a file or record now. We’ll create the presentation when you start the demo review.</p>
          </div>
          <label className="flex flex-col gap-2 text-sm font-semibold text-ink">
            Presentation title (optional)
            <input autoFocus maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)}
              className="rounded-md border border-line bg-paper p-3 font-normal" placeholder="We’ll use today’s date if you skip this" />
          </label>
          <RecorderUploader maxAudioBytes={limits.max_audio_upload_bytes}
            maxAudioDurationSeconds={limits.max_audio_duration_seconds}
            submitLabel="Start presentation with audio"
            onSubmit={startPresentation} />
        </section>
      )}

      <h2 className="font-display text-[27px] font-bold text-ink">Your presentations</h2>
      {!ready ? <p>Loading local presentations…</p> : projects.length === 0 ? (
        <p className="text-muted">No presentations yet. Create one to start practicing.</p>
      ) : (
        <ul className="w-full">
          {projects.map((project) => (
            <li key={project.project_id} className="flex flex-wrap items-start gap-6 border-t border-line p-6">
              <div className="flex flex-1 flex-col gap-2">
                <h3 className="font-display text-[25px] font-bold text-ink">{project.project_title}</h3>
                <p className="text-sm text-muted">{getTakes(recordings, project.project_id).length} attempts</p>
              </div>
              <ButtonLink variant="secondary" href={`/projects/${project.project_id}`}>
                Open presentation →
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[13px] text-muted">Local demo data stays in this browser. AWS sign-in and sync are not connected.</p>
    </PageShell>
  );
}
