"use client";

import { ButtonLink } from "@/components/Button";
import { PageShell } from "@/components/PageHeading";
import { SignInDialog } from "@/components/SignInDialog";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { configured, ready, user } = useAuth();

  return (
    <PageShell>
      {!ready ? (
        <p role="status">Checking your session…</p>
      ) : configured && !user ? (
        <SignInDialog inline />
      ) : (
        <div className="mx-auto flex max-w-md flex-col gap-5">
          <h1 className="font-display text-4xl font-bold">{user ? "You’re signed in" : "Sign in"}</h1>
          {!configured && <p>This preview runs without accounts.</p>}
          <ButtonLink href="/">{user ? "Go to presentations" : "Go to SpeakUp"}</ButtonLink>
        </div>
      )}
    </PageShell>
  );
}
