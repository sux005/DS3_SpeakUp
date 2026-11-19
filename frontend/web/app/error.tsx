"use client"; // Error boundaries must be Client Components

import { Button, ButtonLink } from "@/components/Button";
import { MascotState } from "@/components/MascotState";
import { PageShell } from "@/components/PageHeading";

export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return (
    <PageShell>
      <h1 className="sr-only">Something went wrong</h1>
      <MascotState tone="error" message="Something went wrong." detail="Try again, or go back to your presentations.">
        <Button onClick={() => retry()}>Try again</Button>
        <ButtonLink variant="secondary" href="/">All presentations</ButtonLink>
      </MascotState>
    </PageShell>
  );
}
