import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Recording, RecordingReview } from "@/lib/types";
import { pause, summaryMetrics } from "../fixtures";

const harness = vi.hoisted(() => ({
  params: { recordingId: "recording-1" },
  store: {
    projects: [] as Project[], recordings: [] as Recording[], reviews: {} as Record<string, RecordingReview>, audioUrls: {} as Record<string, string>,
    ready: true, live: true, error: undefined as string | undefined,
    refreshRecording: vi.fn(() => Promise.resolve()), loadReview: vi.fn(() => Promise.resolve()), loadAudio: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("next/navigation", () => ({ useParams: () => harness.params }));
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => createElement("img", { ...props, alt: String(props.alt ?? "") }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/PageHeading", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  PageHeading: ({ title, subtitle }: { title: React.ReactNode; subtitle: string }) => <header><h1>{title}</h1><p>{subtitle}</p></header>,
}));
vi.mock("@/components/ProgressCharts", () => ({ ProgressCharts: () => <div /> }));
vi.mock("@/components/AudioReviewPlayer", () => ({
  AudioReviewPlayer: ({ moments, onMomentSelect, seekRequest }: { moments: Array<{ label: string; at: number; observation?: string; nextStep?: string }>; onMomentSelect?: (moment: { label: string; at: number; observation?: string; nextStep?: string }) => void; seekRequest?: { seconds: number } }) => (
    <div data-testid="player">
      <span data-testid="seek-request">{seekRequest?.seconds ?? "none"}</span>
      {moments.map((moment) => <button key={moment.label} type="button" onClick={() => onMomentSelect?.(moment)}>{moment.label}</button>)}
    </div>
  ),
}));
vi.mock("@/lib/live-store", () => ({ useAppStore: () => harness.store }));

import AnalyzingPage from "@/app/recordings/[recordingId]/analyzing/page";
import ResultsPage from "@/app/recordings/[recordingId]/page";

const project: Project = { project_id: "project-1", project_title: "Live talk", description: "", created_at: "2025-01-01T00:00:00.000Z" };
const recording = (status: Recording["status"]): Recording => ({ project_id: "project-1", recording_id: "recording-1", created_at: "2025-01-02T00:00:00.000Z", status });

beforeEach(() => {
  harness.params.recordingId = "recording-1";
  harness.store.projects = [project]; harness.store.recordings = [recording("PROCESSING")]; harness.store.reviews = {}; harness.store.audioUrls = {};
  harness.store.ready = true; harness.store.live = true; harness.store.error = undefined;
  harness.store.refreshRecording.mockClear(); harness.store.loadReview.mockClear(); harness.store.loadAudio.mockClear();
});
afterEach(() => cleanup());

describe("live recording status and results", () => {
  it("polls status and stops polling when the page unmounts", () => {
    vi.useFakeTimers();
    const view = render(<AnalyzingPage />);
    expect(harness.store.refreshRecording).toHaveBeenCalledWith("recording-1");
    vi.advanceTimersByTime(4_000);
    expect(harness.store.refreshRecording).toHaveBeenCalledTimes(3);
    view.unmount();
    vi.advanceTimersByTime(4_000);
    expect(harness.store.refreshRecording).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("renders backend failures and does not show demo-only copy", () => {
    harness.store.recordings = [recording("FAILED")];
    harness.store.recordings[0].failure_reason = "Transcription timed out.";
    render(<AnalyzingPage />);
    expect(screen.getByRole("heading", { name: "Analysis failed" })).toBeTruthy();
    expect(screen.getByText("Transcription timed out.")).toBeTruthy();
    expect(screen.queryByText(/local demo/i)).toBeNull();
  });

  it("does not poll after a terminal live status", () => {
    vi.useFakeTimers();
    harness.store.recordings = [recording("FAILED")];
    render(<AnalyzingPage />);
    expect(harness.store.refreshRecording).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4_000);
    expect(harness.store.refreshRecording).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("supports a live listening goal while processing", () => {
    render(<AnalyzingPage />);
    expect(screen.getByText("Your recording is being processed. This page will update automatically.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pace" }));
    expect(screen.getByText("Where did you give your audience time to absorb an idea?")).toBeTruthy();
  });

  it("loads completed review and audio, including nullable feedback", () => {
    harness.store.recordings = [recording("COMPLETE")];
    harness.store.reviews = { "recording-1": { recording_id: "recording-1", transcript: { text: "", items: [] }, feedback: null } };
    render(<ResultsPage />);
    expect(harness.store.refreshRecording).toHaveBeenCalledWith("recording-1");
    expect(harness.store.loadReview).toHaveBeenCalledWith("recording-1");
    expect(harness.store.loadAudio).toHaveBeenCalledWith("recording-1");
    expect(screen.getByRole("heading", { name: "Your results" })).toBeTruthy();
    expect(screen.getByText("Coaching isn't available for this recording.")).toBeTruthy();
  });

  it("filters transcript annotations, seeks from a word, and opens a coaching moment", () => {
    harness.store.recordings = [recording("COMPLETE")];
    harness.store.reviews = {
      "recording-1": {
        recording_id: "recording-1",
        transcript: { text: "Um, hello.", items: [
          { type: "pronunciation", start_time: "1", end_time: "1.5", alternatives: [{ content: "Um" }] },
          { type: "punctuation", alternatives: [{ content: "," }] },
          { type: "pronunciation", start_time: "2", end_time: "2.5", alternatives: [{ content: "hello" }] },
          { type: "punctuation", alternatives: [{ content: "." }] },
        ] },
        analysis: { ...summaryMetrics({ duration_seconds: 4, fillers_per_100_words: 2, pauses_per_speaking_minute: 1, rubric_scores: { speaking_rate: 3, filler_words: 2, pauses_inside_sentences: 3 } }), filler_occurrences: [{ start_seconds: 1, end_seconds: 1.5, filler: "Um" }], pauses: [], long_pauses: [] },
        feedback: { feedback: "Good opening.", moments: [{ id: "m1", start_seconds: 1, end_seconds: 1.5, text: "Slow down", kind: "improve", observation: "The filler interrupts the opening.", next_step: "Pause before starting." }] },
      },
    };
    harness.store.audioUrls = { "recording-1": "https://example.test/audio" };
    render(<ResultsPage />);
    expect(screen.getByText("Um,")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fillers (1)" }));
    expect(screen.getByText("Um,")).toBeTruthy();
    fireEvent.click(screen.getByText("hello."));
    expect(screen.getByTestId("seek-request").textContent).toBe("1.5");
    fireEvent.click(screen.getByRole("button", { name: "Try this" }));
    expect(screen.getAllByText("The filler interrupts the opening.").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/Pause before starting/).length).toBeGreaterThan(0);
  });

  it("shows fallback filler and pause markers when feedback moments are absent", () => {
    harness.store.recordings = [recording("COMPLETE")];
    harness.store.reviews = {
      "recording-1": {
        recording_id: "recording-1",
        transcript: { text: "Um, hello.", items: [] },
        analysis: { ...summaryMetrics({ duration_seconds: 4, fillers_per_100_words: 2, pauses_per_speaking_minute: 1, rubric_scores: { speaking_rate: 3, filler_words: 2, pauses_inside_sentences: 3 } }), filler_occurrences: [{ start_seconds: 1, end_seconds: 1.5, filler: "Um" }], pauses: [pause(2, 3)], long_pauses: [pause(2, 3)] },
        feedback: { feedback: "No moments yet.", moments: [] },
      },
    };
    harness.store.audioUrls = { "recording-1": "https://example.test/audio" };
    render(<ResultsPage />);
    const player = within(screen.getByTestId("player"));
    expect(player.getByRole("button", { name: "Filler “Um”" })).toBeTruthy();
    expect(player.getByRole("button", { name: "Pause inside sentence, 1.0 s" })).toBeTruthy();
  });
});
