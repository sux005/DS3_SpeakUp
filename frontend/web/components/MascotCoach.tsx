import type { ReactNode } from "react";
import { Mascot, type MascotState } from "@/components/Mascot";

/**
 * The mascot in a supporting role beside a task, with an optional speech
 * bubble: beside it on phones, above it on wider screens. The bubble is
 * ordinary text, so it is read out and resizes like any other.
 */
export function MascotCoach({ state, children }: { state: MascotState; children?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-4 md:w-52 md:flex-col md:justify-start md:gap-5">
      {children && <p className="speech-bubble min-w-0 flex-1 md:flex-none">{children}</p>}
      <Mascot state={state} flip className="w-24 shrink-0 md:w-36" />
    </div>
  );
}
