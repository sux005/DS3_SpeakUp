import { formatClock, formatDate, formatTake } from "@/lib/recordings";
import { compareToTarget, metricDisplay, targetText, trim } from "@/lib/targets";
import type { Take } from "@/lib/types";

// Chart titles and the target note shown under each trend. Units, values and
// target numbers are shared with the results page through lib/targets.ts.
const charts = [
  { ...metricDisplay("speaking_rate"), title: "Speaking rate", note: "Target range: 135–155 WPM" },
  { ...metricDisplay("filler_words"), title: "Fillers", note: "Score 4: fewer than 2 per 100 words" },
  { ...metricDisplay("pauses_inside_sentences"), title: "Pauses inside sentences", note: "Score 4: fewer than 9 per speaking-minute" },
];

/** Where one value sits between the rubric's best and worst thresholds. */
function RangeBar({ value, band, scale, label }: { value: number; band: [number, number]; scale: [number, number]; label: string }) {
  const low = Math.min(scale[0], value);
  const high = Math.max(scale[1], value);
  const at = (v: number) => ((v - low) / (high - low)) * 100;
  return (
    <div role="img" aria-label={label} className="flex flex-col gap-1.5">
      <div className="relative h-3 rounded-full bg-line">
        <span className="absolute inset-y-0 rounded-full bg-teal/35" style={{ left: `${at(band[0])}%`, width: `${at(band[1]) - at(band[0])}%` }} />
        <span className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-ink" style={{ left: `${at(value)}%` }} />
      </div>
      <div className="flex justify-between text-xs text-muted" aria-hidden="true">
        <span>{trim(low)}</span>
        <span>Shaded: target</span>
        <span>{trim(high)}</span>
      </div>
    </div>
  );
}

const width = 360;
const height = 168;
const padX = 26;
const padTop = 26;
const padBottom = 30;

function Plot({ values, labels, band }: { values: number[]; labels: string[]; band: [number, number] }) {
  const low = Math.min(...values, band[0]);
  const high = Math.max(...values, band[1]);
  const span = high - low || 1;
  const y = (v: number) => height - padBottom - ((v - low) / span) * (height - padTop - padBottom);
  const x = (i: number) => padX + (i / (values.length - 1)) * (width - padX * 2);
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" aria-hidden="true">
      <rect x={0} width={width} y={y(band[1])} height={y(band[0]) - y(band[1])} rx={4} className="fill-teal/15" />
      <text x={width - 6} y={y(band[1]) + 14} textAnchor="end" className="fill-muted text-[11px]">target</text>
      <line x1={0} x2={width} y1={height - padBottom} y2={height - padBottom} className="stroke-line" strokeWidth={2} />
      <polyline points={points} fill="none" strokeWidth={2.5} className="stroke-teal" />
      {values.map((v, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(v)} r={5} className="fill-teal" />
          <text x={x(i)} y={y(v) - 10} textAnchor="middle" className="fill-ink text-[12px] font-semibold">{v}</text>
          <text x={x(i)} y={height - 10} textAnchor="middle" className="fill-muted text-[12px]">{labels[i]}</text>
        </g>
      ))}
    </svg>
  );
}

/**
 * Practice history for a presentation.
 * - Two or more scored attempts: one trend chart per metric.
 * - Exactly one: that attempt's value, score and distance from target. A single
 *   point is not a trend, so no chart is drawn. Pass `single="note"` where the
 *   values are already on the page and only the explanation is wanted.
 * - None: nothing.
 */
export function ProgressCharts({ takes, single = "summary" }: { takes: Take[]; single?: "summary" | "note" }) {
  const scored = takes.filter((t) => t.summary_metrics);
  if (scored.length === 0) return null;

  if (scored.length === 1) {
    const [take] = scored;
    const metrics = take.summary_metrics!;
    if (single === "note") {
      return (
        <section className="flex w-full flex-col gap-1.5">
          <h2 className="font-display text-2xl font-bold text-ink">Your practice, over time.</h2>
          <p className="text-muted">This is the only scored attempt so far. Record another one to compare them here.</p>
        </section>
      );
    }
    return (
      <section className="flex w-full flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-2xl font-bold text-ink">Latest scored attempt</h2>
          <p className="text-[15px] text-muted">{formatTake(take.take)} · {formatDate(take.created_at)} · {formatClock(metrics.duration_seconds)}</p>
        </div>
        <div className="grid w-full gap-x-8 gap-y-7 md:grid-cols-3">
          {charts.map((chart) => {
            const value = chart.value(metrics);
            const score = metrics.rubric_scores[chart.key];
            return (
              <div key={chart.key} className="flex flex-col gap-2.5">
                <h3 className="text-[17px] font-bold text-ink">{chart.title}</h3>
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-display text-4xl font-bold text-ink">{value}</span>
                  <span className="text-[15px] text-muted">{chart.unit}</span>
                </p>
                <p className="text-[15px] text-ink">
                  <span className="font-semibold">{score === null ? "Not scored" : `Score ${score} of 4`}</span>
                  <span className="text-muted"> · Target: {targetText(chart.key)}</span>
                </p>
                <RangeBar value={value} band={chart.band} scale={chart.scale} label={`${value} ${chart.unit}. Target: ${targetText(chart.key)}.`} />
                <p className="text-sm text-muted">{compareToTarget(value, chart.band, score)}</p>
              </div>
            );
          })}
        </div>
        <p className="text-[15px] text-muted">Trends appear here after a second scored attempt.</p>
      </section>
    );
  }

  return (
    <section className="flex w-full flex-col gap-5">
      <h2 className="font-display text-2xl font-bold text-ink">Your practice, over time.</h2>
      <div className="grid w-full gap-x-8 gap-y-7 md:grid-cols-3">
        {charts.map((chart) => {
          const values = scored.map((t) => chart.value(t.summary_metrics!));
          return (
            <div key={chart.key} className="flex flex-col gap-2">
              <h3 className="text-[17px] font-bold text-ink">{chart.title}</h3>
              <p className="text-sm text-muted">{chart.unit}</p>
              <Plot values={values} labels={scored.map((t) => `T${t.take}`)} band={chart.band} />
              <p className="flex flex-wrap gap-x-5 text-sm text-ink">
                {scored.map((t, i) => (
                  <span key={t.recording_id}>
                    {formatTake(t.take)} · {values[i]}
                  </span>
                ))}
              </p>
              <p className="text-sm text-muted">{chart.note}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
