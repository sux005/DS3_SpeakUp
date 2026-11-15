import { pageColumn } from "@/components/PageHeading";

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

/* ---------- The valley ---------- */

function TreeFern({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M0 0C-3-28 4-52 0-78" fill="none" className="stroke-(--scene-outline)" strokeWidth="11" strokeLinecap="round" />
      <path d="M0 0C-3-28 4-52 0-78" fill="none" className="stroke-(--scene-hill-line)" strokeWidth="6" strokeLinecap="round" />
      <g className="fill-(--scene-fern) stroke-(--scene-outline)" strokeWidth="2.4" strokeLinejoin="round">
        {[30, -8, -48, -90, -132, -170, -208].map((angle, index) => (
          <path key={angle} d="M0-78Q24-112 62-96Q28-88 0-78Z" transform={`rotate(${angle} 0 -78)`} className={index % 2 ? "fill-(--scene-fern-deep)" : undefined} />
        ))}
      </g>
    </g>
  );
}

// Firefly positions as [left %, bottom px] of the backdrop.
const fireflies = [[12, 150], [27, 196], [44, 138], [58, 210], [71, 160], [90, 188]];

/**
 * The valley behind the home heading and the sign-in illustration. It fills
 * its parent and has no frame: the sky starts as the page colour, and the
 * ground ends in an uneven cut edge, like a slice lifted out of a dig.
 *
 * Built from separate layers anchored to the bottom so the composition holds
 * at any width: far mesas, drifting mist, a lake, and the ground slice.
 */
export function ValleyBackdrop({ className }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ""}`} aria-hidden="true">
      <div className="absolute inset-0 bg-linear-to-b from-background via-(--scene-sky-mid) to-(--scene-sky-low)" />
      {/* Sun by day, moon at dusk, half hidden by a mesa */}
      <div className="absolute bottom-[150px] left-[56%] size-[150px] rounded-full bg-(--scene-sun-glow)" />
      <div className="absolute bottom-[176px] left-[calc(56%+26px)] size-[98px] rounded-full bg-(--scene-sun)" />

      {/* Far mesas: flat tops of uneven width, low on the left where the heading
          sits and tallest right of centre, with a nearer row of low hills */}
      <svg viewBox="0 0 1600 150" preserveAspectRatio="xMidYMax slice" focusable="false" className="absolute inset-x-0 bottom-[120px] h-[150px] w-full">
        <path className="fill-(--scene-ridge-far) stroke-(--scene-ridge-far)" strokeWidth="8" strokeLinejoin="round"
          d="M-10 150V118L90 118L108 100L250 100L270 120Q360 106 450 118L560 118L580 102L700 102L718 120Q800 110 860 116L900 116L930 44L1060 44L1090 104L1160 104L1184 70L1330 70L1354 112L1440 112L1462 86L1560 86L1580 112L1610 112V150Z" />
        <path className="fill-(--scene-ridge-mid) stroke-(--scene-ridge-mid-line)" strokeWidth="2.5" strokeLinejoin="round"
          d="M-10 150V126Q110 100 226 124Q300 108 384 126L470 126L490 100L604 100L622 128Q760 108 900 130Q1014 112 1120 128L1184 128L1202 106L1334 106L1354 130Q1482 114 1610 128V150Z" />
      </svg>
      <div className="scene-mist absolute bottom-[142px] left-[36%] h-3.5 w-[16%] rounded-full bg-(--scene-mist)" />
      <div className="scene-mist absolute bottom-[190px] left-[4%] h-4 w-[14%] rounded-full bg-(--scene-mist)" />

      {/* Lake */}
      <div className="absolute inset-x-0 bottom-[66px] h-[62px] border-t-[3px] border-(--scene-lake-line) bg-(--scene-lake)">
        {[[6, 14, 70], [19, 30, 36], [41, 12, 84], [57, 28, 44], [78, 16, 64]].map(([left, top, width]) => (
          <span key={left} className="absolute h-1 rounded-full bg-(--scene-lake-light)" style={{ left: `${left}%`, top, width }} />
        ))}
      </div>

      {/* Below the cut edge the page shows through, so the scene has no frame. */}
      <div className="absolute inset-x-0 bottom-0 h-[44px] bg-background" />

      {/* Ground slice: an uneven surface above and a cut edge with strata below */}
      <svg viewBox="0 0 1600 112" preserveAspectRatio="xMidYMax slice" focusable="false" className="absolute inset-x-0 bottom-0 h-[112px] w-full">
        <path className="fill-(--scene-ground) stroke-(--scene-outline)" strokeWidth="3.5" strokeLinejoin="round"
          d="M-10 36Q80 18 190 30Q300 44 400 26Q540 6 690 28Q800 42 930 34Q1070 16 1200 28Q1340 46 1460 24Q1540 12 1610 26V86Q1500 104 1380 92Q1250 78 1120 96Q980 110 840 94Q700 80 560 98Q420 110 290 92Q160 80 60 96L-10 90Z" />
        <g fill="none" className="stroke-(--scene-ground-mark)" strokeWidth="3" strokeLinecap="round">
          <path d="M-10 62Q200 50 420 64Q700 78 960 60Q1240 46 1610 62" />
          <path d="M120 78h54M470 84h90M905 78h48M1290 76h70" strokeDasharray="1 9" />
        </g>
        <g transform="translate(248 56) scale(0.34)" className="text-(--scene-ground-mark)"><AmmoniteShapes /></g>
        <g className="fill-(--scene-ground-mark)">
          <ellipse cx="640" cy="50" rx="9" ry="5" />
          <ellipse cx="664" cy="56" rx="5" ry="3" />
          <ellipse cx="1088" cy="46" rx="8" ry="4.5" />
        </g>
      </svg>

      <div className="scene-fireflies">
        {fireflies.map(([left, bottom]) => (
          <span key={left} style={{ left: `${left}%`, bottom }} />
        ))}
      </div>
    </div>
  );
}

/**
 * A rock ledge with a tree fern behind it and plants at its foot, for the
 * mascot to sit on. Pass the mascot as children; it is placed on the ledge.
 * Size it with a width class: everything inside scales together.
 */
export function Perch({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={`pointer-events-none ${className ?? ""}`}>
      <div className="relative aspect-[44/30] w-full">
      <svg viewBox="0 0 440 300" className="absolute inset-0 size-full overflow-visible" aria-hidden="true" focusable="false">
        <TreeFern x={352} y={214} scale={1.7} />
        <TreeFern x={410} y={236} scale={0.95} />
        <path className="fill-(--scene-rock) stroke-(--scene-outline)" strokeWidth="4" strokeLinejoin="round"
          d="M34 300C22 262 40 236 78 226L104 200C122 184 150 184 176 186L318 182C356 182 384 196 398 222C424 240 432 270 424 300Z" />
        <g fill="none" className="stroke-(--scene-rock-mark)" strokeWidth="3" strokeLinecap="round">
          <path d="M98 216Q230 204 384 220" />
          <path d="M62 256Q210 240 408 258" />
          <path d="M150 282h46M280 278h70" />
        </g>
        <g transform="translate(222 232) scale(0.5)" className="text-(--scene-rock-mark)"><AmmoniteShapes /></g>
      </svg>
      <div className="absolute bottom-[37%] left-[26%] w-[40%]">{children}</div>
      <FernCluster className="absolute bottom-0 -left-[7%] w-[38%]" />
      <Egg className="absolute right-[2%] bottom-[1%] w-[9%]" />
      <Egg cracked className="absolute right-[12%] bottom-0 w-[8%]" />
      </div>
    </div>
  );
}

/**
 * The footer on every page: a ground line with one plant growing on it.
 * Working screens stay calm; the full scenery belongs to home and sign-in.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto w-full pt-14">
      <div className="border-t-2 border-line">
        <div className={`${pageColumn} relative py-5`}>
          <FernCluster shape="low" className="pointer-events-none absolute -top-[46px] right-4 w-20 sm:right-6 lg:right-8" />
          <p className="pr-24 text-sm text-muted">SpeakUp · DS3 at UC San Diego</p>
        </div>
      </div>
    </footer>
  );
}
