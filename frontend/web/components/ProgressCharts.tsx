import { formatTake } from "@/lib/recordings";
import type { SummaryMetrics, Take } from "@/lib/types";

// Target ranges come from the Figma design's score-4 ranges.
const charts: {
  title: string;
  unit: string;
  note: string;
  band: [number, number];
  value: (m: SummaryMetrics) => number;
}[] = [
  {
    title: "Speaking rate",
    unit: "WPM",
    note: "Target range: 135–155 WPM",
    band: [135, 155],
    value: (m) => m.words_per_minute,
  },
  {
    title: "Fillers",
    unit: "per 100 words",
    note: "Score 4: fewer than 2 per 100 words",
    band: [0, 2],
    value: (m) => m.fillers_per_100_words,
  },
  {
    title: "Pauses inside sentences",
    unit: "per speaking-minute",
    note: "Score 4: fewer than 9 per speaking-minute",
    band: [0, 9],
    value: (m) => m.pauses_per_speaking_minute,
  },
];

const width = 420;
const height = 164;
const pad = 12;

function Plot({ values, band }: { values: number[]; band: [number, number] }) {
  const low = Math.min(...values, band[0]);
  const high = Math.max(...values, band[1]);
  const span = high - low || 1;
  const y = (v: number) => height - pad - ((v - low) / span) * (height - pad * 2);
  const x = (i: number) =>
    values.length === 1 ? width / 2 : pad + (i / (values.length - 1)) * (width - pad * 2);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" aria-hidden="true">
      <line x1={pad} x2={width - pad} y1={pad} y2={pad} className="stroke-line" />
      <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} className="stroke-line" />
      <rect
        x={pad}
        width={width - pad * 2}
        y={y(band[1])}
        height={y(band[0]) - y(band[1])}
        className="fill-pale"
      />
      <polyline points={points} fill="none" strokeWidth={2.5} className="stroke-teal" />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={5} className="fill-teal" />
      ))}
    </svg>
  );
}

export function ProgressCharts({ takes }: { takes: Take[] }) {
  const scored = takes.filter((t) => t.summary_metrics);
  if (scored.length === 0) return null;

  return (
    <section className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="font-display text-[29px] font-bold text-ink">Your practice, over time.</h2>
        <p className="font-mono text-[11px] text-teal">COMPARE WITH: PREVIOUS TAKE</p>
      </div>
      <div className="grid w-full gap-7 md:grid-cols-3">
        {charts.map((chart) => {
          const values = scored.map((t) => chart.value(t.summary_metrics!));
          return (
            <div key={chart.title} className="flex flex-col gap-2.5">
              <h3 className="text-[19px] font-bold text-ink">{chart.title}</h3>
              <p className="font-mono text-[11px] text-muted">{chart.unit}</p>
              <Plot values={values} band={chart.band} />
              <p className="flex flex-wrap gap-x-6 font-mono text-[10px] text-muted">
                {scored.map((t, i) => (
                  <span key={t.recording_id}>
                    {formatTake(t.take).toUpperCase()} · {values[i]}
                  </span>
                ))}
              </p>
              <p className="text-[11px] text-muted">{chart.note}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
