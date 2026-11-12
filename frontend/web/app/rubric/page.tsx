import { PageHeading, PageShell } from "@/components/PageHeading";
import { minimumSpeakingSeconds, rubric, rubricVersion } from "@/lib/rubric";

export const metadata = { title: "Rubric · SpeakUp" };

export default function RubricPage() {
  return (
    <PageShell>
      <PageHeading
        crumb="HOW SCORING WORKS"
        title="The Rubric"
        subtitle={`Each recording gets a score from 0 to 4 on three parts of delivery. Recordings need at least ${minimumSpeakingSeconds} seconds of speech to be scored.`}
      />

      <div className="grid w-full gap-6 lg:grid-cols-3">
        {rubric.map((metric) => (
          <section key={metric.key} className="flex flex-col gap-4 border border-line bg-cream p-6">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-[27px] font-bold text-ink">{metric.title}</h2>
              <p className="font-mono text-[11px] text-muted">{metric.unit.toUpperCase()}</p>
            </div>
            <p className="text-[15px] text-ink">{metric.measures}</p>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="font-mono text-[11px] text-muted">
                  <th className="border-b border-line py-2 pr-4 font-normal">SCORE</th>
                  <th className="border-b border-line py-2 font-normal">RANGE</th>
                </tr>
              </thead>
              <tbody>
                {metric.bands.map((band) => (
                  <tr key={band.score} className={band.score === 4 ? "bg-pale" : ""}>
                    <td className="border-b border-line py-3 pr-4 font-display text-2xl font-bold text-teal">
                      {band.score}
                    </td>
                    <td className="border-b border-line py-3 text-[15px] text-ink">{band.range}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <p className="text-xs text-muted">
        Rubric version {rubricVersion}. Scores describe measured delivery, not an overall
        presentation grade.
      </p>
    </PageShell>
  );
}
