// A 0–4 score with a 4-segment bar, used on the results page.
export function RubricScore({ score }: { score: number | null }) {
  if (score === null) {
    return <p className="text-[15px] text-muted">Not scored (under 60s of speech)</p>;
  }
  return (
    <div className="flex items-center gap-3">
      <p className="font-display text-2xl font-bold text-teal">
        {score}
        <span className="text-lg text-muted"> of 4</span>
      </p>
      <div className="flex flex-1 gap-1.5" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`h-2.5 flex-1 rounded-sm ${step <= score ? "bg-teal" : "bg-line"}`}
          />
        ))}
      </div>
    </div>
  );
}
