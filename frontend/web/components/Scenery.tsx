// Original scenery for the prehistoric valley, drawn as inline SVG.
// Colours come from the --scene-* tokens in globals.css, so dark mode turns
// the same valley to dusk. Everything here is decoration: aria-hidden, no text.

const round = (value: number) => Math.round(value * 10) / 10;

/* ---------- Ferns ---------- */

type Frond = { angle: number; length: number; bend: number };

function frondGeometry({ length, bend }: Frond) {
  const steps = Math.round(length / 12);
  const curvature = bend / length;
  const point = (s: number) =>
    Math.abs(curvature) < 1e-4
      ? { x: 0, y: -s }
      : { x: (1 - Math.cos(curvature * s)) / curvature, y: -Math.sin(curvature * s) / curvature };
  const leaves: { cx: number; cy: number; rx: number; ry: number; rotate: number }[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 0.6);
    const { x, y } = point(length * t);
    const tangent = (curvature * length * t * 180) / Math.PI - 90;
    const size = length * 0.3 * Math.min(1, 0.45 + 2.6 * t) * (1 - t) ** 0.7;
    for (const side of [-1, 1]) {
      const rotate = tangent + side * 60;
      const radians = (rotate * Math.PI) / 180;
      leaves.push({
        cx: round(x + (Math.cos(radians) * size) / 2),
        cy: round(y + (Math.sin(radians) * size) / 2),
        rx: round(size / 2),
        ry: round(Math.max(2.6, size * 0.17)),
        rotate: round(rotate),
      });
    }
  }
  const stem = Array.from({ length: steps + 2 }, (_, i) => {
    const { x, y } = point((length * i) / (steps + 1));
    return `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`;
  }).join("");
  return { leaves, stem };
}

const fernShapes: Record<"tall" | "low", Frond[]> = {
  tall: [
    { angle: -58, length: 100, bend: -0.6 },
    { angle: -30, length: 132, bend: -0.4 },
    { angle: -3, length: 148, bend: 0.12 },
    { angle: 25, length: 126, bend: 0.45 },
    { angle: 54, length: 96, bend: 0.6 },
  ],
  low: [
    { angle: -64, length: 92, bend: -0.7 },
    { angle: -24, length: 110, bend: -0.3 },
    { angle: 22, length: 112, bend: 0.3 },
    { angle: 62, length: 94, bend: 0.7 },
  ],
};

/**
 * A clump of fern fronds growing from the bottom centre of its box. The whole
 * clump sways as one element, so the browser moves it without redrawing it.
 */
export function FernCluster({ shape = "tall", className }: { shape?: "tall" | "low"; className?: string }) {
  return (
    <svg viewBox="-150 -160 300 168" className={`fern-sway ${className ?? ""}`} style={{ animationDelay: shape === "low" ? "-2.4s" : undefined }} aria-hidden="true" focusable="false">
      {fernShapes[shape].map((frond, index) => {
        const { leaves, stem } = frondGeometry(frond);
        const ellipses = leaves.map((leaf, i) => (
          <ellipse key={i} cx={leaf.cx} cy={leaf.cy} rx={leaf.rx} ry={leaf.ry} transform={`rotate(${leaf.rotate} ${leaf.cx} ${leaf.cy})`} />
        ));
        return (
          <g key={frond.angle}>
            <g transform={`rotate(${frond.angle})`}>
              <g className="fill-(--scene-outline) stroke-(--scene-outline)" strokeWidth="5" strokeLinejoin="round">
                {ellipses}
                <path d={stem} fill="none" strokeWidth="7" strokeLinecap="round" />
              </g>
              <g className={index % 2 ? "fill-(--scene-fern)" : "fill-(--scene-fern-deep)"}>{ellipses}</g>
              <path d={stem} fill="none" className="stroke-(--scene-fern-rib)" strokeWidth="2.5" strokeLinecap="round" />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- Small props ---------- */

const EGG = "M30 4C46 4 56 28 56 46C56 62 45 72 30 72C15 72 4 62 4 46C4 28 14 4 30 4Z";

function EggShapes({ cracked }: { cracked?: boolean }) {
  return (
    <>
      <path d={EGG} className="fill-(--scene-egg) stroke-(--scene-outline)" strokeWidth="4" />
      <g className="fill-(--scene-egg-spot)">
        <ellipse cx="20" cy="52" rx="5" ry="3.5" />
        <ellipse cx="40" cy="60" rx="6" ry="4" />
        <ellipse cx="42" cy="24" rx="3.5" ry="3" />
      </g>
      {cracked && <path d="M6 40l9-7l7 9l8-9l8 8l8-7l8 5" fill="none" className="stroke-(--scene-outline)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}
    </>
  );
}

/** A speckled dinosaur egg. */
export function Egg({ cracked, className }: { cracked?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 60 76" className={className} aria-hidden="true" focusable="false">
      <EggShapes cracked={cracked} />
    </svg>
  );
}

const spiral = (() => {
  let d = "";
  for (let i = 0; i <= 64; i++) {
    const theta = (i / 64) * Math.PI * 5;
    const radius = 2.5 + theta * 1.55;
    d += `${i === 0 ? "M" : "L"}${round(32 + Math.cos(theta) * radius)} ${round(32 + Math.sin(theta) * radius)}`;
  }
  return d;
})();

function AmmoniteShapes() {
  return (
    <>
      <circle cx="32" cy="32" r="28.5" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path d={spiral} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M51 20l6-4M56 34h6M51 46l6 4M38 55l2 6M22 54l-3 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </>
  );
}

/** A spiral shell fossil. Takes its colour from the text colour. */
export function Ammonite({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <AmmoniteShapes />
    </svg>
  );
}

/** A section divider: a line of rock with one fossil in it. */
export function StrataDivider() {
  return (
    <div role="separator" className="flex w-full items-center gap-3 text-line">
      <span className="h-0.5 flex-1 rounded-full bg-line" />
      <Ammonite className="size-5 text-muted" />
      <span className="h-0.5 flex-1 rounded-full bg-line" />
    </div>
  );
}

/* ---------- The valley ---------- */

function TreeFern({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M0 0C-3-28 4-52 0-78" fill="none" className="stroke-(--scene-hill-line)" strokeWidth="9" strokeLinecap="round" />
      <g className="fill-(--scene-hill-top) stroke-(--scene-hill-line)" strokeWidth="3" strokeLinejoin="round">
        {[30, -8, -48, -90, -132, -170, -208].map((angle) => (
          <path key={angle} d="M0-78Q24-112 62-96Q28-88 0-78Z" transform={`rotate(${angle} 0 -78)`} />
        ))}
      </g>
    </g>
  );
}

function Footprint({ x, y, rotate = 0 }: { x: number; y: number; rotate?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`} className="fill-(--scene-ground-mark)">
      <ellipse cx="0" cy="6" rx="6" ry="7" />
      <ellipse cx="-9" cy="-7" rx="3.5" ry="7" transform="rotate(-24 -9 -7)" />
      <ellipse cx="0" cy="-11" rx="3.5" ry="8" />
      <ellipse cx="9" cy="-7" rx="3.5" ry="7" transform="rotate(24 9 -7)" />
    </g>
  );
}

const sceneBox = {
  viewBox: "0 0 1440 560",
  preserveAspectRatio: "xMidYMax slice",
  focusable: "false",
} as const;

// Firefly positions as [left %, bottom %] of the scene.
const fireflies = [[22, 30], [38, 44], [51, 24], [63, 38], [74, 27], [86, 41]];

/**
 * The landing scene: misty ridges, forested hills, a turquoise lake and a rocky
 * clearing. The sky is left transparent so the section's own gradient shows.
 *
 * Three stacked drawings share one viewBox: the far ridge, the mist, and
 * everything nearer. Keeping the mist on its own layer lets it drift as a
 * whole element instead of redrawing the scene on every frame.
 */
export function ValleyScene({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <svg {...sceneBox} className="absolute inset-0 size-full">
      {/* Sun by day, moon at dusk */}
      <circle cx="1004" cy="196" r="92" className="fill-(--scene-sun-glow)" />
      <circle cx="1004" cy="196" r="58" className="fill-(--scene-sun)" />

      {/* Flyers far off */}
      <g fill="none" className="stroke-(--scene-ridge-mid-line)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1150 122q9-10 18-1q9-9 18 1" />
        <path d="M1206 96q7-8 14-1q7-7 14 1" />
      </g>

      {/* Far ridge, lost in mist */}
      <path className="fill-(--scene-ridge-far)" strokeLinejoin="round"
        d="M0 352L80 322L150 344L250 300L330 336L420 310L520 340L640 286L720 322L810 262L900 320L990 236L1070 300L1168 204L1262 290L1350 246L1440 300V560H0Z" />
      </svg>

      <svg {...sceneBox} className="scene-mist absolute inset-0 size-full overflow-visible fill-(--scene-mist)">
        <rect x="60" y="330" width="380" height="22" rx="11" />
        <rect x="300" y="352" width="240" height="16" rx="8" />
        <rect x="560" y="312" width="300" height="18" rx="9" />
        <rect x="1010" y="286" width="340" height="22" rx="11" />
        <rect x="1180" y="318" width="220" height="16" rx="8" />
      </svg>

      <svg {...sceneBox} className="absolute inset-0 size-full">
      {/* Nearer ridge */}
      <path className="fill-(--scene-ridge-mid) stroke-(--scene-ridge-mid-line)" strokeWidth="3" strokeLinejoin="round"
        d="M-10 392L110 356L210 384L330 342L450 380L580 350L700 388L850 330L960 376L1100 300L1210 364L1330 318L1450 366V560H-10Z" />
      {/* Forested hills with tree ferns */}
      <TreeFern x={1238} y={398} scale={0.9} />
      <TreeFern x={1326} y={410} scale={0.68} />
      <TreeFern x={214} y={412} scale={0.7} />
      <TreeFern x={596} y={420} scale={0.56} />
      <path className="fill-(--scene-hill) stroke-(--scene-hill-line)" strokeWidth="3.5" strokeLinejoin="round"
        d="M-10 430Q110 384 240 414Q340 386 450 418Q600 390 740 426Q880 392 1010 420Q1150 372 1290 404Q1380 388 1450 406V560H-10Z" />
      <g className="fill-(--scene-hill-top)">
        <ellipse cx="120" cy="424" rx="34" ry="9" />
        <ellipse cx="650" cy="424" rx="40" ry="8" />
        <ellipse cx="1150" cy="408" rx="46" ry="9" />
      </g>

      {/* Lake */}
      <path className="fill-(--scene-lake) stroke-(--scene-lake-line)" strokeWidth="3.5"
        d="M-10 446Q360 424 720 440Q1080 454 1450 432V560H-10Z" />
      <g fill="none" className="stroke-(--scene-lake-light)" strokeWidth="4" strokeLinecap="round">
        <path d="M150 458h70M260 470h40M520 456h90M650 470h36M900 462h80M1010 474h40M1240 456h70" />
      </g>

      {/* Rocky clearing */}
      <path className="fill-(--scene-ground) stroke-(--scene-outline)" strokeWidth="4" strokeLinejoin="round"
        d="M-10 496Q200 470 430 488Q700 508 960 482Q1200 462 1450 486V570H-10Z" />
      <Footprint x={470} y={528} rotate={78} />
      <Footprint x={540} y={512} rotate={70} />
      <Footprint x={612} y={530} rotate={80} />
      <Footprint x={684} y={514} rotate={72} />

      {/* Rocks, one with a fossil in it */}
      <g className="fill-(--scene-rock) stroke-(--scene-outline)" strokeWidth="4" strokeLinejoin="round">
        <path d="M300 506Q296 472 334 464Q372 458 388 486Q396 504 384 508Z" />
        <path d="M374 508Q372 490 392 486Q414 484 420 500Q422 508 416 510Z" />
        <path d="M770 512Q762 462 818 452Q880 446 898 490Q904 510 888 514Z" />
        <path d="M1118 492Q1116 474 1140 470Q1164 468 1170 484Q1172 492 1166 494Z" />
      </g>
      <g transform="translate(800 458) scale(0.78)" className="text-(--scene-rock-mark)">
        <AmmoniteShapes />
      </g>

      {/* A clutch of eggs */}
      <g transform="translate(596 446) rotate(-10)"><g transform="scale(0.74)"><EggShapes /></g></g>
      <g transform="translate(644 452) rotate(8)"><g transform="scale(0.82)"><EggShapes /></g></g>

      </svg>

      {/* Fireflies, only at dusk */}
      <div className="scene-fireflies absolute inset-0">
        {fireflies.map(([left, bottom]) => (
          <span key={left} style={{ left: `${left}%`, bottom: `${bottom}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Low hills and ferns along the bottom of every page. */
export function SceneFooter() {
  return (
    <footer className="relative mt-auto w-full overflow-hidden pt-12">
      <svg viewBox="0 0 1440 132" preserveAspectRatio="xMidYMax slice" className="block h-[120px] w-full" aria-hidden="true" focusable="false">
        <path className="fill-(--scene-ridge-far)" d="M0 70L120 38L230 62L370 22L500 60L640 34L760 66L900 26L1040 62L1180 30L1310 58L1440 36V132H0Z" />
        <path className="fill-(--scene-hill) stroke-(--scene-hill-line)" strokeWidth="3.5" strokeLinejoin="round"
          d="M-10 84Q130 44 290 76Q430 50 580 80Q760 46 930 78Q1090 48 1250 74Q1360 58 1450 72V140H-10Z" />
        <path className="fill-(--scene-ground) stroke-(--scene-outline)" strokeWidth="4"
          d="M-10 104Q360 88 720 100Q1080 110 1450 96V140H-10Z" />
      </svg>
      <FernCluster shape="low" className="pointer-events-none absolute -bottom-1 -left-2 w-24 md:left-10 md:w-36" />
      <FernCluster className="pointer-events-none absolute -bottom-1 -right-2 w-20 md:right-14 md:w-32" />
      <p className="absolute inset-x-0 bottom-2.5 px-24 text-center font-mono text-[11px] text-ink md:px-48">
        SPEAKUP · DS3 AT UC SAN DIEGO
      </p>
    </footer>
  );
}
