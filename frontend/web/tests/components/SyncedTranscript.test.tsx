import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SyncedTranscript } from "@/components/SyncedTranscript";
import { toSentences, type Sentence } from "@/lib/transcript";
import type { AnalysisMetrics, Pause, TranscriptItem } from "@/lib/types";
import demoTranscript from "@/data/demo/transcript.json";
import demoAnalysis from "@/data/demo/analysis.json";

const word = (text: string, start: number, end: number, filler = false) => ({ text, start, end, filler });

const sentences: Sentence[] = [
  { id: 0, start: 1, end: 3, text: "Um, hello there.", tag: "FILLER", words: [word("Um,", 1, 1.3, true), word("hello", 1.5, 2), word("there.", 2.6, 3)] },
  { id: 1, start: 4, end: 5, text: "Next point.", tag: "PAUSE", words: [word("Next", 4, 4.4), word("point.", 4.8, 5)] },
];
const pauses: Pause[] = [
  { start_seconds: 2, end_seconds: 2.6, duration_seconds: 0.6, inside_sentence: true },
  { start_seconds: 3, end_seconds: 4, duration_seconds: 1, inside_sentence: false },
];

function renderTranscript(props: Partial<Parameters<typeof SyncedTranscript>[0]> = {}) {
  const onSeek = vi.fn();
  render(<SyncedTranscript sentences={sentences} pauses={pauses} currentTime={0} canSeek onSeek={onSeek} {...props} />);
  return { onSeek, sentenceButtons: within(screen.getByRole("list", { name: "Transcript sentences" })).getAllByRole("button") };
}

describe("SyncedTranscript", () => {
  it("seeks to a sentence's start when the sentence is clicked", () => {
    const { onSeek, sentenceButtons } = renderTranscript();
    fireEvent.click(sentenceButtons[1]);
    expect(onSeek).toHaveBeenCalledWith(4);
  });

  it("seeks to a clicked word with a lead-in that stays inside its sentence", () => {
    const { onSeek } = renderTranscript();
    fireEvent.click(screen.getByText("there."));
    expect(onSeek).toHaveBeenLastCalledWith(2.1);
    fireEvent.click(screen.getByText("Um,"));
    expect(onSeek).toHaveBeenLastCalledWith(1);
  });

  it("marks only the sentence at the current time as current", () => {
    const { sentenceButtons } = renderTranscript({ currentTime: 3.5 });
    expect(sentenceButtons[0].getAttribute("aria-current")).toBe("true");
    expect(sentenceButtons[1].getAttribute("aria-current")).toBeNull();
  });

  it("disables seeking and highlighting without audio", () => {
    const { sentenceButtons } = renderTranscript({ canSeek: false, currentTime: 4.5 });
    expect(sentenceButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(sentenceButtons.some((button) => button.getAttribute("aria-current"))).toBe(false);
  });

  it("labels pauses inside sentences differently from natural pauses between them", () => {
    renderTranscript();
    expect(screen.getByText(/pause inside sentence, 0\.6 s/)).toBeTruthy();
    expect(screen.getByText("· natural pause, 1.0 s")).toBeTruthy();
  });

  it("highlights scored fillers and filters sentences", () => {
    renderTranscript();
    expect(screen.getByText("Um,").className).toContain("text-rose");
    fireEvent.click(screen.getByRole("button", { name: "Fillers (1)" }));
    expect(screen.queryByText("Next")).toBeNull();
    expect(screen.queryByText("· natural pause, 1.0 s")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Pauses" }));
    expect(screen.queryByText("Um,")).toBeNull();
    expect(screen.getByText("Next")).toBeTruthy();
  });

  it("shows a message when a filter matches nothing", () => {
    render(<SyncedTranscript sentences={[sentences[0]]} pauses={[]} currentTime={0} canSeek onSeek={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Pauses" }));
    expect(screen.getByText("Nothing to show for this filter.")).toBeTruthy();
  });

  it("places every pause from the real demo analysis", () => {
    const metrics = demoAnalysis.data.metrics as AnalysisMetrics;
    const demoSentences = toSentences(demoTranscript.data.items as TranscriptItem[], metrics);
    render(<SyncedTranscript sentences={demoSentences} pauses={metrics.pauses} currentTime={0} canSeek onSeek={vi.fn()} />);
    const inline = document.querySelectorAll("li [title]").length;
    const between = screen.queryAllByText(/^(· natural pause|‖ pause inside sentence), /).length;
    expect(inline + between).toBe(metrics.pauses.length);
    expect(screen.getByRole("button", { name: `Fillers (${metrics.filler_count})` })).toBeTruthy();
  });
});
