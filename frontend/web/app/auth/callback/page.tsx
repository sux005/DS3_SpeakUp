"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ButtonLink } from "@/components/Button";
import { MascotState } from "@/components/MascotState";
import { PageShell } from "@/components/PageHeading";
import { useAuth } from "@/lib/auth";

// Where Cognito sends people back after Google sign-in. It trades the one-time code
// for tokens, then returns to the page they started from.
export default function GoogleCallbackPage() {
  return <Suspense fallback={<PageShell><MascotState busy message="Finishing sign-in…" /></PageShell>}><Callback /></Suspense>;
}

function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const { ready, finishGoogleSignIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  // The code works once, so a second effect run (React's development double run) must not reuse it.
  const started = useRef(false);

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      // Cognito sends ?error=... when someone cancels on Google's page.
      queueMicrotask(() => setError(params.get("error") ? "Google sign-in was cancelled." : "This sign-in link is missing its code. Try signing in again."));
      return;
    }
    finishGoogleSignIn(code, state)
      .then((next) => router.replace(next))
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "Google sign-in didn’t finish. Try again."));
  }, [ready, params, finishGoogleSignIn, router]);

  return (
    <PageShell>
      {error ? (
        <MascotState message={error}><ButtonLink href="/">Back to SpeakUp</ButtonLink></MascotState>
      ) : (
        <MascotState busy message="Finishing sign-in…" />
      )}
    </PageShell>
  );
}
