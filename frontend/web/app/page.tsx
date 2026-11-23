"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { pageColumn } from "@/components/PageHeading";
import { Button, ButtonLink } from "@/components/Button";
import { Mascot } from "@/components/Mascot";
import { HomeSkeleton } from "@/components/LoadingSkeleton";
import { FernCluster, Perch, ValleyBackdrop } from "@/components/Scenery";
import { RecorderUploader } from "@/components/RecorderUploader";
import { useAppStore } from "@/lib/live-store";
import { EXAMPLE_PROJECT_ID } from "@/lib/api";
import { formatDate, formatTake, getTakes } from "@/lib/recordings";
import type { Take } from "@/lib/types";

// What happened to a presentation's latest attempt, and where to go for it.
function latestAttempt(take: Take) {
  const label = formatTake(take.take);
  if (take.status === "COMPLETE") {
    return { note: take.summary_metrics ? `${label} is scored` : `${label} is recorded`, href: `/recordings/${take.recording_id}`, action: `Review ${label.toLowerCase()}` };
  }
  if (take.status === "FAILED") return { note: `${label} failed` };
  if (take.status === "DELETED" || take.status === "PURGE_PENDING") return { note: `${label} was removed` };
  return { note: `${label} is processing`, href: `/recordings/${take.recording_id}/analyzing`, action: "View status" };
}

export default function Home() {
  const router = useRouter();
  const { projects, recordings, reviews, createProject, createRecording, limits, ready, error, live } = useAppStore();
  const exampleProject = projects.find((project) => project.project_id === EXAMPLE_PROJECT_ID);
  // A finished, scored take to point newcomers at, when one exists.
  const scored = recordings.find((recording) => recording.status === "COMPLETE" && reviews[recording.recording_id]?.analysis);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const pendingProject = useRef<{ name: string; id: string } | null>(null);
  const newPresentationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!creating) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    newPresentationRef.current?.scrollIntoView?.({ behavior: reducedMotion ? "instant" : "smooth", block: "center" });
  }, [creating]);

  async function startPresentation(audio: Blob, filename: string) {
    if (!ready) return;
    const name = title.trim() || `Presentation ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date())}`;
    let projectId = pendingProject.current?.name === name ? pendingProject.current.id : undefined;
    if (!projectId) {
      projectId = await createProject(name, "");
      pendingProject.current = { name, id: projectId };
    }
    const recordingId = await createRecording(projectId, audio, filename);
    router.push(`/recordings/${recordingId}/analyzing`);
  }

  // Most recently worked-on presentation first: by its latest attempt, else by when it was created.
  const presentations = projects.filter((project) => project.project_id !== EXAMPLE_PROJECT_ID)
    .map((project) => {
      const takes = getTakes(recordings, project.project_id);
      const last = takes.at(-1);
      return { project, attempts: takes.length, last, touched: last?.created_at ?? project.created_at };
    })
    .sort((a, b) => b.touched.localeCompare(a.touched));
  const [recent, ...others] = presentations;
  const firstVisit = ready && presentations.length === 0;
  const latest = recent?.last && latestAttempt(recent.last);

  return (
    <main className="flex w-full flex-col">
      {/* The valley runs edge to edge behind the heading. It is taller on a first visit,
          and steps back once there are presentations to get to. */}
      <div className="relative isolate w-full">
        <ValleyBackdrop className="-z-10" />
        <div className={`${pageColumn} relative`}>
          <div className={`flex max-w-xl flex-col items-start gap-4 ${firstVisit ? "pt-12 pb-[270px] md:pt-20 md:pb-[190px]" : "pt-9 pb-[250px] md:pt-12 md:pb-[160px]"}`}>
            <p className="font-mono text-xs text-teal">{live ? "LIVE SYNC" : "LOCAL DEMO"}</p>
            {firstVisit && <p className="font-display text-6xl font-bold leading-none tracking-tight text-ink md:text-7xl">SpeakUp</p>}
            <h1 className={`font-display font-bold tracking-tight text-ink ${firstVisit ? "text-3xl" : "text-4xl md:text-5xl"}`}>Practice your next presentation</h1>
            <p className="text-[17px] text-ink">
              Record a talk, read it back as a transcript, and see your pace, filler words and pauses, with feedback for your next take.
            </p>
            <Button variant={recent ? "secondary" : "primary"} disabled={!ready} aria-expanded={creating} aria-controls="new-presentation" onClick={() => setCreating((value) => !value)}>
              {creating ? "Cancel" : "+ New presentation"}
            </Button>
          </div>
          <Perch className={`absolute right-2 bottom-[44px] sm:right-6 lg:right-8 ${firstVisit ? "w-[270px] md:w-[400px] lg:w-[480px]" : "w-[250px] md:w-[340px] lg:w-[420px]"}`}>
            {firstVisit && (
              <p className="speech-bubble speech-bubble-down absolute bottom-full left-1/2 mb-4 w-max max-w-[14rem] -translate-x-1/2">Ready when you are.</p>
            )}
            <Mascot flip className="w-full" sizes="(min-width: 1024px) 300px, 200px" />
          </Perch>
        </div>
      </div>

      <div className={`${pageColumn} relative flex flex-col items-start gap-8 pb-4`}>
        {/* One plant in front of everything ties the scene to the content below it. */}
        <FernCluster className="pointer-events-none absolute -top-[98px] -left-4 z-20 w-28 md:-left-12 md:w-36" />

        {creating && (
          <section ref={newPresentationRef} id="new-presentation" className="relative z-10 -mt-8 flex w-full flex-col gap-5 rounded-2xl border-2 border-outline bg-card p-6">
            <div>
              <h2 className="font-display text-2xl font-bold text-ink">Start with your audio</h2>
              <p className="mt-1.5 text-muted">Upload a file or record now. We’ll create the presentation when you start the review.</p>
            </div>
            <label className="flex max-w-xl flex-col gap-2 font-semibold text-ink">
              Presentation title (optional)
              <input maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)}
                className="rounded-xl border-2 border-line bg-background p-3 text-base font-normal" placeholder="We’ll use today’s date if you skip this" />
            </label>
            <RecorderUploader live={live} maxAudioBytes={limits.max_audio_upload_bytes}
              maxAudioDurationSeconds={limits.max_audio_duration_seconds}
              submitLabel="Start presentation with audio"
              onSubmit={startPresentation} />
          </section>
        )}

        {exampleProject && (
          <section aria-labelledby="examples-heading" className="relative z-10 w-full rounded-2xl border-2 border-outline bg-card p-6 md:p-7">
            <p className="label">Explore before you record</p>
            <h2 id="examples-heading" className="mt-2 font-display text-2xl font-bold text-ink">Example speeches</h2>
            <p className="mt-2 max-w-2xl text-muted">Hear a stronger delivery and one with clear areas to improve. Open either detailed review to see how SpeakUp explains pace, filler words, and pauses.</p>
            <Link href={`/projects/${EXAMPLE_PROJECT_ID}`} className="mt-4 inline-block font-semibold text-teal underline decoration-2 underline-offset-4">Explore the example project →</Link>
          </section>
        )}

        <section aria-labelledby="presentations-heading" className={`flex w-full flex-col gap-6 ${creating ? "" : "-mt-8"}`}>
          <h2 id="presentations-heading" className={recent ? "sr-only" : "pt-10 font-display text-[28px] font-bold text-ink"}>Your presentations</h2>
          {error && <p className="text-sm text-rust" role="alert">{error}</p>}
          {!ready ? <HomeSkeleton label={live ? "Loading presentations…" : "Loading local presentations…"} /> : !recent ? (
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold text-ink">No presentations yet.</p>
              <p className="text-muted">Create one to start practicing.</p>
            </div>
          ) : (
            <>
              <article className="relative z-10 flex w-full flex-col gap-5 rounded-2xl border-2 border-outline bg-card p-6 md:flex-row md:items-end md:justify-between md:p-7">
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="label">Pick up where you left off</p>
                  <h3 className="font-display text-3xl font-bold break-words text-ink">{recent.project.project_title}</h3>
                  <p className="flex flex-wrap items-center gap-x-2 text-[15px] text-muted">
                    <span>{recent.attempts} {recent.attempts === 1 ? "attempt" : "attempts"}</span>
                    {recent.last && latest && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Last attempt {formatDate(recent.last.created_at)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{latest.note}</span>
                        {latest.href && (
                          <Link href={latest.href} className="font-semibold text-teal underline decoration-2 underline-offset-4">{latest.action}</Link>
                        )}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <ButtonLink href={`/projects/${recent.project.project_id}/new`}>+ New attempt</ButtonLink>
                  <ButtonLink variant="secondary" href={`/projects/${recent.project.project_id}`}>Open presentation →</ButtonLink>
                </div>
              </article>

              {others.length > 0 && (
                <div className="flex w-full flex-col gap-3">
                  <h2 className="font-display text-2xl font-bold text-ink">Other presentations</h2>
                  <ul className="w-full overflow-hidden rounded-2xl border-2 border-line bg-card">
                    {others.map(({ project, attempts, last }) => (
                      <li key={project.project_id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t-2 border-line px-5 py-3.5 first:border-t-0">
                        <div className="flex min-w-0 flex-1 basis-56 flex-wrap items-baseline gap-x-3">
                          <h3 className="text-[17px] font-bold break-words text-ink">{project.project_title}</h3>
                          <p className="flex flex-wrap gap-x-2 text-sm text-muted">
                            <span>{attempts} {attempts === 1 ? "attempt" : "attempts"}</span>
                            {last && <><span aria-hidden="true">·</span><span>Last attempt {formatDate(last.created_at)}</span></>}
                          </p>
                        </div>
                        <Link href={`/projects/${project.project_id}`} className="nav-link text-[15px] font-semibold text-teal">Open presentation →</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>

        <div className="flex flex-col gap-2">
          {scored && (
            <p className="text-muted">
              New here?{" "}
              <Link href={`/recordings/${scored.recording_id}`} className="font-semibold text-teal underline decoration-2 underline-offset-4">
                See what a finished review looks like
              </Link>
              .
            </p>
          )}
          {!live && <p className="text-sm text-muted">Local demo data stays in this browser. AWS sign-in and sync are not connected.</p>}
        </div>
      </div>
    </main>
  );
}
