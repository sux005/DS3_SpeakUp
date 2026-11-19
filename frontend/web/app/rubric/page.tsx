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

      <div className="grid w-full gap-5 lg:grid-cols-3">
        {rubric.map((metric) => (
          <section key={metric.key} className="flex flex-col overflow-hidden rounded-2xl border-2 border-line bg-card">
            {/* What is measured, and in what unit, stay together above the scores. */}
            <div className="flex flex-col gap-2 p-6 pb-5">
              <h2 className="font-display text-[26px] font-bold leading-tight text-ink">{metric.title}</h2>
              <p className="label">{metric.unit}</p>
              <p className="text-base text-ink">{metric.measures}</p>
            </div>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="label">
                  <th scope="col" className="border-y-2 border-line bg-background/60 py-2 pr-4 pl-6 font-semibold">Score</th>
                  <th scope="col" className="border-y-2 border-line bg-background/60 py-2 pr-6 font-semibold">Range</th>
                </tr>
              </thead>
              <tbody>
                {metric.bands.map((band) => (
                  <tr key={band.score} className={band.score === 4 ? "bg-pale" : ""}>
                    <td className="w-20 border-b border-line py-3 pr-4 pl-6 font-display text-2xl font-bold text-teal last:border-b-0">
                      {band.score}
                    </td>
                    <td className="border-b border-line py-3 pr-6 text-base text-ink">
                      {band.range}
                      {band.score === 4 && <span className="label ml-3 text-teal">Target</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <p className="text-sm text-muted">
        Rubric version {rubricVersion}. Scores describe measured delivery, not an overall
        presentation grade.
      </p>
    </PageShell>
  );
}
