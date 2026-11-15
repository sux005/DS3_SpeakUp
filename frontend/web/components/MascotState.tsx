import type { ReactNode } from "react";
import { Mascot, type MascotPose } from "@/components/Mascot";

/**
 * A small mascot moment for loading, empty, error and success states.
 * `busy` is the compact loading row; otherwise it is a centred panel with an
 * optional line of detail and actions (pass buttons as children).
 */
export function MascotState({
  pose,
  variant,
  message,
  detail,
  busy,
  children,
}: {
  pose: MascotPose;
  variant?: "full" | "egg";
  message: string;
  detail?: ReactNode;
  busy?: boolean;
  children?: ReactNode;
}) {
  if (busy) {
    return (
      <div role="status" className="flex items-center gap-4 py-4">
        <span className="mascot-float shrink-0"><Mascot pose={pose} className="w-16" /></span>
        <p className="font-mono text-sm text-muted">{message}</p>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-line px-6 py-10 text-center">
      <Mascot pose={pose} variant={variant} className="w-32" />
      <p className="font-display text-2xl font-bold text-ink">{message}</p>
      {detail && <p className="max-w-md text-muted">{detail}</p>}
      {children && <div className="mt-2 flex flex-wrap justify-center gap-3">{children}</div>}
    </div>
  );
}
