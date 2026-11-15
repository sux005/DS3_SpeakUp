import type { ReactNode } from "react";

// The DS3 dinosaur, redrawn as inline SVG so it can blink and sit on any surface.
// Stand-in artwork drawn from screenshots: swap the shapes here when the official
// files arrive and every screen picks them up.

export type MascotPose = "wave" | "cheer" | "listen" | "think" | "celebrate" | "oops" | "sleep";

type Eyes = "open" | "up" | "wink" | "happy" | "closed" | "worried";
type Mouth = "smile" | "open" | "small" | "wavy";
type Arm = "rest" | "wave" | "up" | "chin";
type Extra = "sound" | "dots" | "sparkles" | "sweat" | "zzz";

const poses: Record<MascotPose, { eyes: Eyes; mouth: Mouth; arm: Arm; extra?: Extra }> = {
  wave: { eyes: "open", mouth: "open", arm: "wave" },
  cheer: { eyes: "wink", mouth: "smile", arm: "up" },
  listen: { eyes: "open", mouth: "smile", arm: "rest", extra: "sound" },
  think: { eyes: "up", mouth: "small", arm: "chin", extra: "dots" },
  celebrate: { eyes: "happy", mouth: "open", arm: "up", extra: "sparkles" },
  oops: { eyes: "worried", mouth: "wavy", arm: "rest", extra: "sweat" },
  sleep: { eyes: "closed", mouth: "small", arm: "rest", extra: "zzz" },
};

const INK = "#1b2a22";
const BODY = "#f5a033";
const TRACE = "#2f43d6";
const SHELL = "#fff3d6";

const HEAD = "M92 88C92 54 110 36 148 36L182 36C212 36 228 52 228 80L228 94C228 122 210 136 180 136L150 136C112 136 92 122 92 88Z";

// Tail, body, head and feet. Drawn twice (thick ink pass, then fill) so the
// parts merge into one silhouette with a single outline around it.
function Silhouette({ headOnly }: { headOnly?: boolean }) {
  if (headOnly) return <path d={HEAD} />;
  return (
    <>
      <path d="M104 198C70 204 38 190 30 150C25 122 28 92 36 66C48 98 66 124 96 142Z" />
      <path d="M78 170C78 138 98 122 126 122C156 122 174 140 174 170C174 200 156 216 126 216C98 216 78 202 78 170Z" />
      <path d={HEAD} />
      <ellipse cx="104" cy="213" rx="19" ry="10" />
      <ellipse cx="150" cy="213" rx="19" ry="10" />
    </>
  );
}

function Outlined({ headOnly }: { headOnly?: boolean }) {
  return (
    <>
      <g fill={INK} stroke={INK} strokeWidth="11" strokeLinejoin="round"><Silhouette headOnly={headOnly} /></g>
      <g fill={BODY}><Silhouette headOnly={headOnly} /></g>
    </>
  );
}

const armPaths: Record<Arm, string> = {
  rest: "M158 160C170 164 178 160 184 150",
  wave: "M158 160C176 166 198 162 212 146",
  up: "M158 160C176 166 198 162 212 146",
  chin: "M158 164C172 164 182 154 180 140",
};

function Face({ eyes, mouth }: { eyes: Eyes; mouth: Mouth }) {
  const line = { stroke: INK, strokeWidth: 5, strokeLinecap: "round" as const, fill: "none" };
  const lift = eyes === "up" ? -3 : 0;
  const openEye = (cx: number, cy: number) => (
    <>
      <rect x={cx - 6.5} y={cy - 9 + lift} width="13" height="18" rx="5.5" fill={INK} />
      <circle cx={cx + 2} cy={cy - 4 + lift * 1.5} r="2.5" fill="#fff" />
    </>
  );
  return (
    <>
      {(eyes === "open" || eyes === "up" || eyes === "worried") && (
        <g className="mascot-eyes">{openEye(152, 84)}{openEye(190, 82)}</g>
      )}
      {eyes === "wink" && (
        <>
          <g className="mascot-eyes">{openEye(152, 84)}</g>
          <path d="M182 85Q190 76 198 85" {...line} />
        </>
      )}
      {eyes === "happy" && <path d="M144 88Q152 77 160 88M182 86Q190 75 198 86" {...line} />}
      {eyes === "closed" && <path d="M144 84Q152 92 160 84M182 82Q190 90 198 82" {...line} />}
      {eyes === "worried" && <path d="M142 70L160 65M182 64L200 69" {...line} strokeWidth={4} />}

      {mouth === "smile" && (
        <>
          <path d="M158 108C170 120 192 119 204 104" {...line} />
          <path d="M189 114l5 9l5-12" fill="#fff" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
        </>
      )}
      {mouth === "open" && (
        <>
          <path d="M159 105Q182 111 205 102Q202 128 181 128Q163 127 159 105Z" fill="#5b2414" stroke={INK} strokeWidth="5" strokeLinejoin="round" />
          <path d="M170 122Q181 113 193 121Q187 127 181 127Q175 127 170 122Z" fill="#f47a5e" />
          <path d="M190 107l4 8l5-10" fill="#fff" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        </>
      )}
      {mouth === "small" && <ellipse cx="184" cy="113" rx="5" ry="6" fill={INK} />}
      {mouth === "wavy" && <path d="M160 113q6-7 12 0t12 0t12 0" {...line} />}
    </>
  );
}

function Extras({ extra }: { extra?: Extra }): ReactNode {
  if (extra === "sound") {
    return (
      <g stroke="#3fbfb5" strokeWidth="5" strokeLinecap="round" fill="none" className="mascot-pulse">
        <path d="M238 58q9 14 1 30" />
        <path d="M248 48q15 24 2 50" />
      </g>
    );
  }
  if (extra === "dots") {
    return (
      <g fill={SHELL} stroke={INK} strokeWidth="3" className="mascot-pulse">
        <circle cx="98" cy="34" r="4" />
        <circle cx="86" cy="21" r="5.5" />
        <circle cx="70" cy="9" r="6.5" />
      </g>
    );
  }
  if (extra === "sparkles") {
    const star = "M0-11Q1.5-1.5 11 0Q1.5 1.5 0 11Q-1.5 1.5-11 0Q-1.5-1.5 0-11Z";
    return (
      <g fill="#ffd35c" stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
        <path d={star} transform="translate(238 34)" />
        <path d={star} transform="translate(66 34) scale(0.8)" />
        <path d={star} transform="translate(220 150) scale(0.6)" />
      </g>
    );
  }
  if (extra === "sweat") {
    return <path d="M84 30C91 40 94 46 94 51A10 10 0 0 1 74 51C74 46 77 40 84 30Z" fill="#8fdcec" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />;
  }
  if (extra === "zzz") {
    return (
      <g stroke={INK} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M96 30h10l-10 12h10" />
        <path d="M76 8h13l-13 15h13" />
      </g>
    );
  }
  return null;
}

export function Mascot({
  pose = "wave",
  variant = "full",
  flip = false,
  title,
  className,
}: {
  pose?: MascotPose;
  /** "egg" shows the head peeking out of a hatching egg. */
  variant?: "full" | "egg";
  /** Face left instead of right. */
  flip?: boolean;
  /** Accessible name. Leave out when the mascot is decoration. */
  title?: string;
  className?: string;
}) {
  const { eyes, mouth, arm, extra } = poses[pose];
  const a11y = title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true as const };

  return (
    <svg viewBox="0 0 260 240" fill="none" className={className} data-mascot={pose} {...a11y}>
      <g transform={flip ? "translate(260 0) scale(-1 1)" : undefined}>
        {variant === "egg" ? (
          <>
            <ellipse cx="131" cy="229" rx="66" ry="7" fill="#10231a" opacity="0.16" />
            <g transform="translate(-29 10)">
              <Outlined headOnly />
              <Face eyes={eyes} mouth={mouth} />
              {/* A piece of shell still sitting on the head. */}
              <path d="M128 40l10-13l13 10l14-12l11 13l12-7l6 15q-33-9-66-6z" fill={SHELL} stroke={INK} strokeWidth="5" strokeLinejoin="round" />
            </g>
            <path d="M56 150L74 136L92 152L111 136L131 152L151 136L169 152L188 136L206 150C210 196 180 230 131 230C82 230 52 196 56 150Z" fill={SHELL} stroke={INK} strokeWidth="5.5" strokeLinejoin="round" />
            <g fill="#e9c98b">
              <ellipse cx="92" cy="182" rx="7" ry="5" />
              <ellipse cx="150" cy="204" rx="9" ry="6" />
              <ellipse cx="172" cy="172" rx="5" ry="4" />
              <ellipse cx="118" cy="212" rx="4" ry="3" />
            </g>
          </>
        ) : (
          <>
            <ellipse cx="126" cy="226" rx="72" ry="7" fill="#10231a" opacity="0.16" />
            <Outlined />
            <path d="M98 209v8M108 209v8M144 209v8M154 209v8" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
            {/* Circuit traces along the tail and back. */}
            <g stroke={TRACE} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M44 150V118L52 106" />
              <path d="M62 178V156L74 144" />
              <path d="M96 190H110L120 180" />
              <circle cx="54" cy="98" r="7" fill={BODY} />
              <circle cx="79" cy="138" r="7" fill={BODY} />
              <circle cx="126" cy="174" r="7" fill={BODY} />
            </g>
            <path d={armPaths[arm]} stroke={INK} strokeWidth="17" strokeLinecap="round" />
            <path d={armPaths[arm]} stroke={BODY} strokeWidth="8" strokeLinecap="round" />
            {arm === "wave" && (
              <path d="M224 132q8 4 10 13M231 122q13 7 16 21" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
            )}
            <Face eyes={eyes} mouth={mouth} />
            <Extras extra={extra} />
          </>
        )}
      </g>
    </svg>
  );
}
