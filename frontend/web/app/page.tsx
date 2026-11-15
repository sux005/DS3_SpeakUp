"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/PageHeading";
import { Button, ButtonLink } from "@/components/Button";
import { Mascot } from "@/components/Mascot";
import { MascotState } from "@/components/MascotState";
import { Egg, FernCluster, ValleyScene } from "@/components/Scenery";
import { RecorderUploader } from "@/components/RecorderUploader";
import { useDemoStore } from "@/lib/demo-store";
import { getTakes } from "@/lib/recordings";

export default function Home() {
  const router = useRouter();
  const { projects, recordings, reviews, createProject, createRecording, limits, ready } = useDemoStore();
  // A finished, scored take to point newcomers at, when one exists.
  const scored = recordings.find((recording) => recording.status === "COMPLETE" && reviews[recording.recording_id]?.analysis);
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
      <section className="relative w-full">
        <div className="relative isolate overflow-hidden rounded-3xl border-2 border-outline bg-linear-to-b from-(--scene-sky-top) via-(--scene-sky-mid) to-(--scene-sky-low)">
          <ValleyScene className="absolute inset-x-0 bottom-0 -z-10 h-[300px] w-full md:h-full" />
          <div className="flex max-w-2xl flex-col items-start gap-4 p-6 pb-[270px] md:p-12 md:pb-[300px]">
            <p className="font-mono text-xs text-teal">LOCAL DEMO</p>
            <p className="font-display text-6xl font-bold leading-none tracking-tight text-ink md:text-8xl">SpeakUp</p>
            <h1 className="font-display text-2xl font-bold text-ink md:text-3xl">Practice your next presentation</h1>
            <p className="max-w-xl text-[17px] text-ink">
              Record a talk, read it back as a transcript, and see your pace, filler words and pauses, with feedback for your next take.
            </p>
            <Button variant="accent" disabled={!ready} aria-expanded={creating} aria-controls="new-presentation" onClick={() => setCreating((value) => !value)}>
              {creating ? "Cancel" : "+ New presentation"}
            </Button>
          </div>
          <div className="pointer-events-none absolute bottom-3 right-2 flex items-end md:bottom-5 md:right-[7%]">
            <Egg cracked className="mb-2 w-9 md:mb-3 md:w-14" />
            <Mascot pose="wave" flip className="w-40 md:w-64" />
          </div>
        </div>
        <FernCluster className="pointer-events-none absolute -bottom-2 -left-3 w-28 md:-left-5 md:w-44" />
        <FernCluster shape="low" className="pointer-events-none absolute -bottom-2 right-[36%] hidden w-36 md:block" />
      </section>

      {creating && (
        <section id="new-presentation" className="flex w-full flex-col gap-5 rounded-2xl border-2 border-line bg-pale p-6">
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">Start with your audio</h2>
            <p className="mt-2 text-sm text-muted">Upload a file or record now. We’ll create the presentation when you start the demo review.</p>
          </div>
          <label className="flex flex-col gap-2 text-sm font-semibold text-ink">
            Presentation title (optional)
            <input autoFocus maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)}
              className="rounded-xl border-2 border-line bg-card p-3 text-base font-normal" placeholder="We’ll use today’s date if you skip this" />
          </label>
          <RecorderUploader maxAudioBytes={limits.max_audio_upload_bytes}
            maxAudioDurationSeconds={limits.max_audio_duration_seconds}
            submitLabel="Start presentation with audio"
            onSubmit={startPresentation} />
        </section>
      )}

      <h2 className="font-display text-[27px] font-bold text-ink">Your presentations</h2>
      {!ready ? <MascotState busy pose="think" message="Loading local presentations…" /> : projects.length === 0 ? (
        <MascotState pose="wave" variant="egg" message="No presentations yet." detail="Create one to start practicing." />
      ) : (
        <ul className="flex w-full flex-col gap-4">
          {projects.map((project) => {
            const attempts = getTakes(recordings, project.project_id).length;
            return (
            <li key={project.project_id} className="flex flex-wrap items-center gap-4 rounded-2xl border-2 border-line bg-card p-5 sm:gap-6 sm:p-6">
              {/* The egg cracks once a presentation has its first attempt. */}
              <Egg cracked={attempts > 0} className="w-9 shrink-0" />
              <div className="flex min-w-0 flex-1 basis-44 flex-col gap-1">
                <h3 className="font-display text-[25px] font-bold break-words text-ink">{project.project_title}</h3>
                <p className="text-sm text-muted">{attempts} {attempts === 1 ? "attempt" : "attempts"}</p>
              </div>
              <ButtonLink variant="secondary" href={`/projects/${project.project_id}`}>
                Open presentation →
              </ButtonLink>
            </li>
            );
          })}
        </ul>
      )}
      {scored && (
        <p className="text-muted">
          New here?{" "}
          <Link href={`/recordings/${scored.recording_id}`} className="font-semibold text-teal underline decoration-2 underline-offset-4">
            See what a finished review looks like
          </Link>
          .
        </p>
      )}
      <p className="text-[13px] text-muted">Local demo data stays in this browser. AWS sign-in and sync are not connected.</p>
    </PageShell>
  );
}
