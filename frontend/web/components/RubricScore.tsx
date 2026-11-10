// A big 0–4 score with a 4-segment bar, used on the results page.
export function RubricScore({ score }: { score: number | null }) {
  if (score === null) {
    return <p className="font-mono text-sm text-muted">Not scored (under 60s of speech)</p>;
  }
  return (
    <div className="flex items-center gap-4">
      <p className="font-display text-5xl font-bold text-teal">
        {score}
        <span className="text-2xl text-muted">/4</span>
      </p>
      <div className="flex flex-1 gap-1.5" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`h-3 flex-1 rounded-sm ${step <= score ? "bg-teal" : "bg-line"}`}
          />
        ))}
      </div>
    </div>
  );
}
