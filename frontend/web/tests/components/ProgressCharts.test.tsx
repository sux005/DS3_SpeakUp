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

  it("renders all metric charts, target notes, and only scored take values", () => {
    render(<ProgressCharts takes={[take("take1", 120), take("take2"), take("take3", 145)]} />);
    expect(screen.getByRole("heading", { name: "Your practice, over time." })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Speaking rate" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Fillers" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pauses inside sentences" })).toBeTruthy();
    expect(screen.getByText("Target range: 135–155 WPM")).toBeTruthy();
    expect(screen.getByText("Score 4: fewer than 2 per 100 words")).toBeTruthy();
    expect(screen.getByText("Score 4: fewer than 9 per speaking-minute")).toBeTruthy();
    expect(screen.getByText(/TAKE 01 · 120/)).toBeTruthy();
    expect(screen.getByText(/TAKE 03 · 145/)).toBeTruthy();
    expect(screen.queryByText(/TAKE 02/)).toBeNull();
    expect(document.querySelectorAll("svg")).toHaveLength(3);
    expect(document.querySelectorAll("circle")).toHaveLength(6);
  });

  it("supports a single scored take without producing invalid chart geometry", () => {
    render(<ProgressCharts takes={[take("take4", 140)]} />);
    const plots = document.querySelectorAll("svg");
    expect(plots).toHaveLength(3);
    expect(document.querySelectorAll("polyline")).toHaveLength(3);
    expect(document.querySelectorAll("circle")).toHaveLength(3);
    expect(document.body.textContent).not.toContain("NaN");
  });
});
