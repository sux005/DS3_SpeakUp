import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SummaryFeedback } from "@/components/SummaryFeedback";
import { rubric } from "@/lib/rubric";
import type { AnalysisMetrics, RecordingReview } from "@/lib/types";
import demoAnalysis from "@/data/demo/analysis.json";

const metrics = demoAnalysis.data.metrics as AnalysisMetrics;
const transcript = { text: "", items: [] };
const step = (name: RegExp) => screen.getByRole("heading", { name }).parentElement!;

const coached: RecordingReview = {
  recording_id: "r1",
  transcript,
  analysis: metrics,
  feedback: {
    feedback: "You kept a steady pace.",
    schema_version: 2,
    categories: { general: { observation: "Your structure was clear.", next_step: "Open with your main claim." } },
    moments: [{ id: "m1", start_seconds: 12.5, end_seconds: 14, text: "on the other hand", kind: "improve", observation: "Two fillers in a row.", next_step: "Pause instead." }],
  },
};

describe("SummaryFeedback with coaching", () => {
  it("goes from what happened, to evidence, to what to try next", () => {
    const onSeek = vi.fn();
    render(<SummaryFeedback review={coached} metrics={metrics} canSeek onSeek={onSeek} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(within(step(/What happened/)).getByText("You kept a steady pace.")).toBeTruthy();
    expect(within(step(/What happened/)).getByText("Your structure was clear.")).toBeTruthy();
    expect(within(step(/Supporting evidence/)).getByText("Try this · “on the other hand”")).toBeTruthy();
    expect(within(step(/What to try next/)).getByText("Open with your main claim.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Play from 00:12/ }));
    expect(onSeek).toHaveBeenCalledWith(12.5);
  });

  it("falls back to the rubric for a next step when coaching has no general category", () => {
    const review = { ...coached, feedback: { feedback: "Older summary only." } };
    render(<SummaryFeedback review={review} metrics={metrics} canSeek onSeek={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /Rubric tip for your lowest score: Filler words/ })).toBeTruthy();
    expect(screen.getByText(rubric[1].tips[0])).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Supporting evidence.*From your measurements/ })).toBeTruthy();
  });
});

describe("SummaryFeedback without coaching", () => {
  const review: RecordingReview = { recording_id: "r1", transcript, analysis: metrics, feedback: null };

  it("says coaching is unavailable and labels everything as measured", () => {
    render(<SummaryFeedback review={review} metrics={metrics} canSeek={false} onSeek={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("Coaching isn't available for this recording.");
    expect(screen.getByRole("heading", { name: /What happened.*From your measurements/ })).toBeTruthy();
    expect(within(step(/What happened/)).getByText("Filler words: 0/4")).toBeTruthy();
  });

  it("lists real filler and pause times as evidence, disabled without audio", () => {
    render(<SummaryFeedback review={review} metrics={metrics} canSeek={false} onSeek={vi.fn()} />);
    const buttons = within(step(/Supporting evidence/)).getAllByRole("button");
    expect(buttons).toHaveLength(6);
    expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    const first = metrics.filler_occurrences[0];
    expect(screen.getByRole("button", { name: new RegExp(`Play from 00:0${Math.floor(first.start_seconds)}: Filler “${first.filler}”`) })).toBeTruthy();
  });

  it("handles a review with no measurements or scores", () => {
    render(<SummaryFeedback review={{ ...review, analysis: undefined }} canSeek={false} onSeek={vi.fn()} />);
    expect(screen.getByText("No measurements are available for this recording.")).toBeTruthy();
    expect(screen.getByText("No timed events to show.")).toBeTruthy();
    expect(screen.getByText(/Record at least 60 seconds/)).toBeTruthy();
  });

  it("reports unscored metrics", () => {
    const unscored = { ...metrics, rubric_scores: { speaking_rate: null, filler_words: null, pauses_inside_sentences: null } };
    render(<SummaryFeedback review={review} metrics={unscored} canSeek onSeek={vi.fn()} />);
    expect(screen.getByText("Speaking rate: not scored")).toBeTruthy();
    expect(screen.getByText(/Record at least 60 seconds/)).toBeTruthy();
  });
});
