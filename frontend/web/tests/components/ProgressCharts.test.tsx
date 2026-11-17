import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressCharts } from "@/components/ProgressCharts";
import type { Take } from "@/lib/types";
import { summaryMetrics } from "../fixtures";

const take = (id: string, score?: number): Take => ({
  project_id: "p1",
  recording_id: id,
  created_at: "2025-01-01T00:00:00.000Z",
  status: "COMPLETE",
  take: Number(id.replace(/\D/g, "")) || 1,
  ...(score === undefined ? {} : {
    summary_metrics: summaryMetrics({
      duration_seconds: 60,
      words_per_minute: score,
      fillers_per_100_words: 1,
      pauses_per_speaking_minute: 4,
      rubric_scores: { speaking_rate: 3, filler_words: 4, pauses_inside_sentences: 3 },
    }),
  }),
});

describe("ProgressCharts", () => {
  it("renders nothing when there are no scored takes", () => {
    const { container } = render(<ProgressCharts takes={[take("take1"), take("take2")]} />);
    expect(container.firstChild).toBeNull();
  });

  it("draws a trend per metric once two attempts are scored, skipping unscored ones", () => {
    render(<ProgressCharts takes={[take("take1", 120), take("take2"), take("take3", 145)]} />);
    expect(screen.getByRole("heading", { name: "Your practice, over time." })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Speaking rate" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Fillers" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pauses inside sentences" })).toBeTruthy();
    expect(screen.getByText("Target range: 135–155 WPM")).toBeTruthy();
    expect(screen.getByText("Score 4: fewer than 2 per 100 words")).toBeTruthy();
    expect(screen.getByText("Score 4: fewer than 9 per speaking-minute")).toBeTruthy();
    expect(screen.getByText(/Take 01 · 120/)).toBeTruthy();
    expect(screen.getByText(/Take 03 · 145/)).toBeTruthy();
    expect(screen.queryByText(/Take 02/)).toBeNull();
    expect(document.querySelectorAll("svg")).toHaveLength(3);
    expect(document.querySelectorAll("circle")).toHaveLength(6);
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("summarises a single scored attempt instead of drawing a one-point trend", () => {
    render(<ProgressCharts takes={[take("take4", 140)]} />);
    expect(screen.getByRole("heading", { name: "Latest scored attempt" })).toBeTruthy();
    expect(document.querySelectorAll("svg")).toHaveLength(0);
    expect(screen.getByText("140")).toBeTruthy();
    expect(screen.getAllByText("Score 3 of 4")).toHaveLength(2);
    expect(screen.getByText("Score 4 of 4")).toBeTruthy();
    expect(screen.getByText(/Target: 135–155 WPM/)).toBeTruthy();
    expect(screen.getByText(/Target: fewer than 2/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "140 WPM. Target: 135–155 WPM." })).toBeTruthy();
    expect(screen.getByText("Trends appear here after a second scored attempt.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("states the distance from target by subtraction, and trusts the score for on-target", () => {
    const metrics = (wpm: number, fillers: number, scores: [number | null, number | null, number | null]): Take => ({
      ...take("take1", wpm),
      summary_metrics: summaryMetrics({
        duration_seconds: 60, words_per_minute: wpm, fillers_per_100_words: fillers, pauses_per_speaking_minute: 20,
        rubric_scores: { speaking_rate: scores[0], filler_words: scores[1], pauses_inside_sentences: scores[2] },
      }),
    });
    const { unmount } = render(<ProgressCharts takes={[metrics(134.08, 11.64, [3, 0, null])]} />);
    expect(screen.getByText("0.92 below the target range")).toBeTruthy();
    expect(screen.getByText("9.64 above the target")).toBeTruthy();
    expect(screen.getByText("Not scored")).toBeTruthy();
    expect(screen.getByText("11 above the target")).toBeTruthy();
    unmount();

    render(<ProgressCharts takes={[metrics(160, 1, [3, 4, 0])]} />);
    expect(screen.getByText("5 above the target")).toBeTruthy();
    expect(screen.getByText("In the target range")).toBeTruthy();
    unmount();

    // On the boundary without a score of 4: no claim either way.
    render(<ProgressCharts takes={[metrics(155, 2, [3, 3, 0])]} />);
    expect(screen.getAllByText("At the edge of the target range")).toHaveLength(2);
  });

  it("shows only an explanation where the values are already on the page", () => {
    render(<ProgressCharts takes={[take("take4", 140)]} single="note" />);
    expect(screen.getByText("This is the only scored attempt so far. Record another one to compare them here.")).toBeTruthy();
    expect(screen.queryByText("140")).toBeNull();
  });
});
