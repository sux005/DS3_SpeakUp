import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreCards } from "@/components/ScoreCards";
import { rubric } from "@/lib/rubric";
import type { AnalysisMetrics } from "@/lib/types";
import demoAnalysis from "@/data/demo/analysis.json";

const demo = demoAnalysis.data.metrics as AnalysisMetrics;
const card = (title: string) => screen.getByRole("article", { name: title });

describe("ScoreCards", () => {
  it("shows the measured value, unit, score, target range and rubric tip for each metric", () => {
    render(<ScoreCards metrics={demo} />);
    expect(screen.getAllByRole("article")).toHaveLength(3);
    const rate = card("Speaking rate");
    expect(within(rate).getByText("134.08")).toBeTruthy();
    expect(within(rate).getByText("WPM")).toBeTruthy();
    expect(within(rate).getByRole("img", { name: "Score 3 out of 4" })).toBeTruthy();
    expect(within(rate.querySelector("dl")!).getByText("135–155 WPM")).toBeTruthy();
    expect(within(rate).getByText("Rubric tip")).toBeTruthy();
    expect(within(rate).getByText(rubric[0].tips[3])).toBeTruthy();
    expect(within(card("Filler words")).getByRole("img", { name: "Score 0 out of 4" })).toBeTruthy();
  });

  it("keeps scored fillers apart from watch-list words, and inside pauses apart from natural ones", () => {
    render(<ScoreCards metrics={demo} />);
    expect(within(card("Filler words")).getByText("32 scored fillers: um ×11, uh ×21")).toBeTruthy();
    expect(within(card("Filler words")).getByText("Watch list, not scored: “so” ×6")).toBeTruthy();
    const pauses = card("Pauses inside sentences");
    expect(within(pauses).getByText("19 pauses inside sentences (scored)")).toBeTruthy();
    expect(within(pauses).getByText("10 natural pauses between sentences (not scored)")).toBeTruthy();
  });

  it("uses coaching for a metric when the backend sent it", () => {
    render(<ScoreCards metrics={demo} categories={{ fillers: { observation: "Fillers cluster at sentence starts.", next_step: "Breathe before starting." } }} />);
    const fillers = card("Filler words");
    expect(within(fillers).getByText("Coaching")).toBeTruthy();
    expect(within(fillers).getByText("Fillers cluster at sentence starts.")).toBeTruthy();
    expect(within(fillers).getByText(/Breathe before starting/)).toBeTruthy();
    expect(within(card("Speaking rate")).getByText("Rubric tip")).toBeTruthy();
  });

  it("explains an unscored metric instead of showing a tip", () => {
    render(<ScoreCards metrics={{ ...demo, rubric_scores: { ...demo.rubric_scores, speaking_rate: null } }} />);
    const rate = card("Speaking rate");
    expect(within(rate).getByRole("img", { name: "Not scored" })).toBeTruthy();
    expect(within(rate).getByText(/Record at least 60 seconds/)).toBeTruthy();
  });

  it("omits count lines the analysis doesn't include", () => {
    const bare: AnalysisMetrics = { ...demo };
    for (const key of ["filler_count", "filler_words", "watch_words", "pauses_inside_sentences", "pauses_between_sentences"] as const) delete bare[key];
    render(<ScoreCards metrics={bare} />);
    expect(screen.queryByText(/scored fillers/)).toBeNull();
    expect(screen.queryByText(/natural pauses/)).toBeNull();
  });

  it("expands the full rubric and marks the band for this score", () => {
    render(<ScoreCards metrics={demo} />);
    const rate = card("Speaking rate");
    const toggle = within(rate).getByRole("button", { name: /Full rubric/ });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hasAttribute("inert")).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hasAttribute("inert")).toBe(false);
    const current = within(panel).getAllByRole("row").filter((row) => row.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("120–135 or 155–170 WPM");
  });
});
