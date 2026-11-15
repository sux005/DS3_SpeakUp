import type { ReactNode } from "react";
import { Mascot } from "@/components/Mascot";

type Tone = "loading" | "error" | "plain";

// The mascot image never changes with the state. A small badge beside it does.
function Cue({ tone }: { tone: Tone }) {
  if (tone === "loading") {
    return (
      <span aria-hidden="true" className="analyzing-dots absolute -top-1 -right-3 flex h-7 items-center gap-1 rounded-full border-2 border-outline bg-card px-2">
        {[0, 1, 2].map((dot) => <span key={dot} className="size-1.5 rounded-full bg-ink" />)}
      </span>
    );
  }
  if (tone === "error") {
    return (
      <span aria-hidden="true" className="absolute -top-1 -right-3 flex size-8 items-center justify-center rounded-full border-2 border-outline bg-card">
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none">
          <path d="M12 3.5 21.5 20h-19Z" className="fill-peach stroke-outline" strokeWidth="2" strokeLinejoin="round" />
          <path d="M12 10v4.5M12 17.2v.1" className="stroke-outline" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return null;
}

/**
 * A small mascot moment for loading, empty, error and unavailable states.
 * `busy` is the compact loading row; otherwise it is a centred panel with an
 * optional line of detail and actions (pass buttons as children). The text
 * always carries the meaning; the mascot and its badge are decoration.
 */
export function MascotState({
  tone = "plain",
  message,
  detail,
  busy,
  children,
}: {
  tone?: Tone;
  message: string;
  detail?: ReactNode;
  busy?: boolean;
  children?: ReactNode;
}) {
  if (busy) {
    return (
      <div role="status" className="flex items-center gap-4 py-4">
        <Mascot className="w-14 shrink-0" sizes="96px" />
        <p className="text-[15px] text-muted">{message}</p>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-line px-6 py-10 text-center">
      <span className="relative">
        <Mascot className="w-28" sizes="192px" />
        <Cue tone={tone} />
      </span>
      <p className="font-display text-2xl font-bold text-ink">{message}</p>
      {detail && <p className="max-w-md text-muted">{detail}</p>}
      {children && <div className="mt-2 flex flex-wrap justify-center gap-3">{children}</div>}
    </div>
  );
}
