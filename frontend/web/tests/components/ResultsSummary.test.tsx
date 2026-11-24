import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EvidenceList, NextStep, Takeaway } from "@/components/ResultsSummary";
import { rubric } from "@/lib/rubric";
import type { AnalysisMetrics, RecordingReview } from "@/lib/types";
import demoAnalysis from "@/data/demo/analysis.json";
import { summaryMetrics } from "../fixtures";
import demoTranscript from "@/data/demo/transcript.json";

const metrics = demoAnalysis.data.metrics as AnalysisMetrics;
const transcript = { text: "", items: [] };
const uncoached: RecordingReview = { recording_id: "r1", transcript, summary_metrics: summaryMetrics(), analysis: metrics, feedback: null };
const coached: RecordingReview = {
  recording_id: "r1",
  transcript,
  summary_metrics: summaryMetrics(),
  analysis: metrics,
  feedback: {
    feedback: "You kept a steady pace.",
    schema_version: 2,
    categories: { general: { observation: "Your structure was clear.", next_step: "Open with your main claim." } },
    moments: [{ id: "m1", start_seconds: 12.5, end_seconds: 14, text: "on the other hand", kind: "improve", observation: "Two fillers in a row.", next_step: "Pause instead." }],
  },
};

describe("Takeaway", () => {
  it("without coaching, shows a measured strength and priority and says coaching is unavailable", () => {
    render(<Takeaway review={uncoached} metrics={metrics} canSeek onSeek={vi.fn()} />);
    const region = screen.getByRole("region", { name: "Your takeaway" });
    expect(within(region).getByText("Strength")).toBeTruthy();
    // Speaking rate and pauses tie at 3 of 4 in the demo clip, so both are named.
    expect(within(region).getByText("Speaking rate and pauses inside sentences")).toBeTruthy();
    expect(within(region).getByText("Both scored 3 of 4.")).toBeTruthy();
    expect(within(region).getByText(/^Pauses inside sentences: 10\.71 per speaking-minute, 1\.71 above the target/)).toBeTruthy();
    expect(within(region).getByText("Work on")).toBeTruthy();
    expect(within(region).getByText("Filler words")).toBeTruthy();
    expect(within(region).getAllByText("From your measurements")).toHaveLength(2);
    expect(screen.getByRole("status").textContent).toContain("Coaching isn\u0027t available for this recording.");
    expect(within(region).queryByRole("button")).toBeNull();
  });

  it("with coaching, leads with the coach\u0027s words and plays a coached moment", () => {
    const onSeek = vi.fn();
    render(<Takeaway review={coached} metrics={metrics} canSeek onSeek={onSeek} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("You kept a steady pace.")).toBeTruthy();
    expect(screen.getByText("Your structure was clear.")).toBeTruthy();
    expect(screen.getByText("“on the other hand”")).toBeTruthy();
    expect(screen.getByText("From coaching")).toBeTruthy();
    // No coached strength, so that line falls back to a measurement and says so.
    expect(screen.getByText("From your measurements")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Play from 00:12/ }));
    expect(onSeek).toHaveBeenCalledWith(12.5);
  });

  it("turns off playing a moment when there is no audio", () => {
    render(<Takeaway review={coached} metrics={metrics} canSeek={false} onSeek={vi.fn()} />);
    expect((screen.getByRole("button", { name: /Play from 00:12/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("gives a plain note instead of lines it cannot support", () => {
    render(<Takeaway review={{ ...uncoached, analysis: undefined }} canSeek={false} onSeek={vi.fn()} />);
    expect(screen.getByText("No measurements are available for this recording.")).toBeTruthy();
    expect(screen.queryByText("Strength")).toBeNull();
    expect(screen.queryByText("Work on")).toBeNull();
  });

  it("keeps the approved results mascot as decoration", () => {
    const { container } = render(<Takeaway review={uncoached} metrics={metrics} canSeek onSeek={vi.fn()} />);
    expect(container.querySelector('[data-mascot="results"] img')!.getAttribute("alt")).toBe("");
  });
});

describe("EvidenceList", () => {
  it("lists real filler and pause times, each playing from its moment", () => {
    const onSeek = vi.fn();
    render(<EvidenceList review={uncoached} metrics={metrics} canSeek onSeek={onSeek} />);
    expect(screen.getByRole("heading", { name: "Moments to replay" })).toBeTruthy();
    expect(screen.getByText("From your measurements")).toBeTruthy();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(6);
    const first = metrics.filler_occurrences[0];
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Play from 00:0${Math.floor(first.start_seconds)}: Filler “${first.filler}”`) }));
    // A filler plays from its own time, and its sentence is found at that same time.
    expect(onSeek).toHaveBeenCalledWith(first.start_seconds, first.start_seconds);
  });

  // Regression: clicking a pause used to seek to the instant it began, so
  // playback started inside the silence or just after it.
  it("plays a pause from the start of the word before it, and finds its sentence at the pause itself", () => {
    const onSeek = vi.fn();
    const withWords: RecordingReview = { ...uncoached, transcript: demoTranscript.data };
    render(<EvidenceList review={withWords} metrics={metrics} canSeek onSeek={onSeek} />);
    // In the demo clip, "um" runs 14.69 to 15.16 s, then this pause, then "um" again at 15.67 s.
    const pause = metrics.pauses.find((item) => item.start_seconds === 15.16)!;
    expect(pause.end_seconds).toBe(15.67);
    const row = screen.getByText("Pause inside a sentence, 0.5 s").closest("li")!;
    fireEvent.click(within(row).getByRole("button"));
    expect(onSeek).toHaveBeenCalledOnce();
    expect(onSeek).toHaveBeenCalledWith(14.69, 15.16);
    // The label still shows when the pause happens; the button says where playback starts.
    expect(within(row).getByRole("button").textContent).toBe("00:15");
    expect(within(row).getByRole("button").getAttribute("aria-label")).toBe("Play from 00:14: Pause inside a sentence, 0.5 s");
  });

  it("falls back to one second before a pause when the transcript has no words", () => {
    const onSeek = vi.fn();
    render(<EvidenceList review={uncoached} metrics={metrics} canSeek onSeek={onSeek} />);
    fireEvent.click(within(screen.getByText("Pause inside a sentence, 0.5 s").closest("li")!).getByRole("button"));
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(14.16);
  });

  it("starts at zero for a pause in the first second of the recording", () => {
    const onSeek = vi.fn();
    const early: AnalysisMetrics = { ...metrics, filler_occurrences: [], pauses: [{ start_seconds: 0.7, end_seconds: 1.3, duration_seconds: 0.6, inside_sentence: true }] };
    render(<EvidenceList review={uncoached} metrics={early} canSeek onSeek={onSeek} />);
    fireEvent.click(screen.getByRole("button", { name: "Play from 00:00: Pause inside a sentence, 0.6 s" }));
    expect(onSeek).toHaveBeenCalledWith(0, 0.7);
  });

  it("plays a coached moment from its own time", () => {
    const onSeek = vi.fn();
    render(<EvidenceList review={coached} metrics={metrics} canSeek onSeek={onSeek} />);
    fireEvent.click(screen.getByRole("button", { name: /Play from 00:12: Try this/ }));
    expect(onSeek).toHaveBeenCalledWith(12.5, 12.5);
  });

  it("uses coaching moments when present and is disabled without audio", () => {
    render(<EvidenceList review={coached} metrics={metrics} canSeek={false} onSeek={vi.fn()} />);
    expect(screen.getByText("From coaching")).toBeTruthy();
    expect(screen.getByText("Try this · “on the other hand”")).toBeTruthy();
    expect(screen.getByText("Two fillers in a row.")).toBeTruthy();
    expect(screen.getAllByRole("button").every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it("says when there is nothing timed to show", () => {
    render(<EvidenceList review={{ ...uncoached, analysis: undefined }} canSeek={false} onSeek={vi.fn()} />);
    expect(screen.getByText("No timed events to show.")).toBeTruthy();
    expect(screen.queryByText(/^From /)).toBeNull();
  });
});

describe("NextStep", () => {
  it("gives the coach\u0027s next step when there is one", () => {
    render(<NextStep review={coached} metrics={metrics} practiceHref="/projects/p1/new" />);
    const region = screen.getByRole("region", { name: "Your next practice step" });
    expect(within(region).getByText("Open with your main claim.")).toBeTruthy();
    expect(within(region).getByText("From coaching")).toBeTruthy();
    expect(within(region).getByRole("link", { name: "Record another attempt →" }).getAttribute("href")).toBe("/projects/p1/new");
  });

  it("otherwise gives one rubric tip and labels it as rubric-based", () => {
    render(<NextStep review={uncoached} metrics={metrics} practiceHref="/x" />);
    expect(screen.getByText(rubric[1].tips[0])).toBeTruthy();
    expect(screen.getByText("Rubric tip for your lowest score: Filler words")).toBeTruthy();
  });

  it("asks for more speech when nothing is scored", () => {
    render(<NextStep review={{ ...uncoached, analysis: undefined }} practiceHref="/x" />);
    expect(screen.getByText(/Record at least 60 seconds/)).toBeTruthy();
    expect(screen.queryByText(/Rubric tip/)).toBeNull();
  });
});
