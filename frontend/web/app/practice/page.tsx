"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { MascotState } from "@/components/MascotState";
import { PageHeading, PageShell } from "@/components/PageHeading";
import { RecorderUploader, type RecorderStatus } from "@/components/RecorderUploader";
import { useAuth } from "@/lib/auth";
import { useAppStore } from "@/lib/live-store";
import { PRACTICE_PROMPTS, PRACTICE_SECONDS, nextPrompt, promptDescription, type PracticePrompt } from "@/lib/practice-prompts";

// The 2-minute warm-up speech. A newcomer gets a topic with a few things to talk
// about, records for up to two minutes, and the take becomes their first
// presentation: a starting score to compare later practice against.
export default function PracticePage() {
  const router = useRouter();
  const { createProject, createRecording, limits, ready, error, live } = useAppStore();
  const { configured, user, openSignIn } = useAuth();
  const [prompt, setPrompt] = useState<PracticePrompt>(PRACTICE_PROMPTS[0]);
  const [status, setStatus] = useState<RecorderStatus>("idle");

  // Pick a random topic after the first render, so the server and browser agree on the first paint.
  useEffect(() => {
    const random = PRACTICE_PROMPTS[Math.floor(Math.random() * PRACTICE_PROMPTS.length)];
    queueMicrotask(() => setPrompt(random));
  }, []);

  const onStatusChange = useCallback((next: RecorderStatus) => setStatus(next), []);

  async function save(audio: Blob, filename: string) {
    const projectId = await createProject(`Warm-up: ${prompt.title}`, promptDescription(prompt));
    const recordingId = await createRecording(projectId, audio, filename);
    router.push(`/recordings/${recordingId}/analyzing`);
  }

  // Anyone can record. Saving needs an account when accounts are set up, so a guest
  // signs in first and the take they just recorded is saved right after.
  async function submit(audio: Blob, filename: string) {
    if (configured && !user) {
      openSignIn(() => void save(audio, filename).catch(() => undefined));
      return;
    }
    await save(audio, filename);
  }

  if (!ready) return <PageShell><MascotState busy message="Getting your practice ready…" /></PageShell>;

  return (
    <PageShell>
      <PageHeading
        crumb="MY PRESENTATIONS"
        crumbHref="/"
        title="2-minute practice speech"
        subtitle="Talk about the topic below for up to two minutes. Your score becomes the starting point that later practice is compared against."
      />

      <section aria-labelledby="prompt-title" className="flex w-full flex-col gap-4 rounded-2xl border-2 border-outline bg-card p-6 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="label">Your topic</p>
            <h2 id="prompt-title" className="font-display text-3xl font-bold text-ink">{prompt.title}</h2>
          </div>
          <Button variant="secondary" disabled={status !== "idle"} onClick={() => setPrompt(nextPrompt(prompt))}>
            Another topic
          </Button>
        </div>
        <p className="text-[17px] text-ink">{prompt.intro}</p>
        <div>
          <p className="font-semibold text-ink">Things you could cover</p>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-[17px] text-ink">
            {prompt.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </div>
        <p className="text-sm text-muted">You don’t have to cover every point or use them in order. Speak the way you would to a friend.</p>
      </section>

      <section aria-label="Record your practice speech" className="flex w-full flex-col gap-3 rounded-2xl border-2 border-line bg-card p-6">
        <h2 className="font-display text-2xl font-bold text-ink">Record when you’re ready</h2>
        <p className="text-muted">Take a few seconds to think first if you like. Recording stops on its own at 2:00, or stop early when you’re done.</p>
        {configured && !user && <p className="text-muted">You’ll sign in before your score is saved, so you can track progress over time.</p>}
        {error && <p className="text-sm text-rust" role="alert">{error}</p>}
        <RecorderUploader
          live={live}
          maxAudioBytes={limits.max_audio_upload_bytes}
          maxAudioDurationSeconds={PRACTICE_SECONDS}
          allowUpload={false}
          submitLabel="Score my practice speech"
          onStatusChange={onStatusChange}
          onSubmit={submit}
        />
      </section>
    </PageShell>
  );
}
