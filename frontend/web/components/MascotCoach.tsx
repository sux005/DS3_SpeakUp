import type { ReactNode } from "react";
import { Mascot, type MascotPose } from "@/components/Mascot";

/** The mascot with a speech bubble: beside it on phones, above it on wider screens. */
export function MascotCoach({ pose, children }: { pose: MascotPose; children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-4 md:w-56 md:flex-col md:gap-5">
      <p className="speech-bubble min-w-0 flex-1 md:flex-none">{children}</p>
      <Mascot pose={pose} flip className="w-24 shrink-0 md:w-44" />
    </div>
  );
}
