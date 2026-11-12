import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Recording, RecordingReview } from "@/lib/types";

const harness = vi.hoisted(() => ({
  params: { projectId: "project-1", recordingId: "recording-1" },
  router: { push: vi.fn() },
  store: {
    projects: [] as Project[],
    recordings: [] as Recording[],
    reviews: {} as Record<string, RecordingReview>,
    audioUrls: {} as Record<string, string>,
    limits: { max_audio_upload_bytes: 104_857_600, max_audio_duration_seconds: 600 },
    ready: true,
    createProject: vi.fn(() => "created-project"),
    createRecording: vi.fn(() => "created-recording"),
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => harness.params,
  useRouter: () => harness.router,
}));
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => createElement("img", { ...props, alt: String(props.alt ?? "") }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/PageHeading", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  PageHeading: ({ crumb, title, subtitle }: { crumb: string; title: React.ReactNode; subtitle: string }) => <header><span>{crumb}</span><h1>{title}</h1><p>{subtitle}</p></header>,
}));
vi.mock("@/components/RecorderUploader", () => ({
  RecorderUploader: ({ onSubmit, submitLabel = "Analyze demo recording" }: { onSubmit: (blob: Blob, name: string) => void; submitLabel?: string }) => <button type="button" onClick={() => onSubmit(new Blob(["audio"], { type: "audio/wav" }), "test.wav")}>{submitLabel}</button>,
}));
vi.mock("@/components/ProgressCharts", () => ({ ProgressCharts: ({ takes }: { takes: Recording[] }) => <div data-testid="charts">charts:{takes.length}</div> }));
vi.mock("@/components/AudioReviewPlayer", () => ({
  AudioReviewPlayer: ({ moments, onMomentSelect }: { moments: Array<{ label: string; observation?: string; nextStep?: string }>; onMomentSelect?: (moment: { at: number; label: string; observation?: string; nextStep?: string }) => void }) => <div data-testid="player">{moments.map((moment, index) => <button key={index} type="button" onClick={() => onMomentSelect?.({ ...moment, at: index })}>{moment.label}</button>)}</div>,
}));
vi.mock("@/lib/demo-store", () => ({ useDemoStore: () => harness.store }));

import Home from "@/app/page";
import ProjectPage from "@/app/projects/[projectId]/page";
import NewAttemptPage from "@/app/projects/[projectId]/new/page";
import AnalyzingPage from "@/app/recordings/[recordingId]/analyzing/page";
import ResultsPage from "@/app/recordings/[recordingId]/page";

const project = (id = "project-1"): Project => ({ project_id: id, project_title: "Demo project", description: "", created_at: "2025-01-01T00:00:00.000Z" });
const recording = (id: string, status: Recording["status"] = "COMPLETE", projectId = "project-1"): Recording => ({ project_id: projectId, recording_id: id, created_at: "2025-01-02T00:00:00.000Z", status });

beforeEach(() => {
  harness.params.projectId = "project-1";
  harness.params.recordingId = "recording-1";
  harness.router.push.mockReset();
  harness.store.projects = [project()];
  harness.store.recordings = [recording("recording-1")];
  harness.store.reviews = {};
  harness.store.audioUrls = {};
  harness.store.ready = true;
  harness.store.createProject.mockReset().mockReturnValue("created-project");
  harness.store.createRecording.mockReset().mockReturnValue("created-recording");
});
afterEach(() => cleanup());

describe("home and project routes", () => {
  it("shows loading and empty presentation states", () => {
    harness.store.ready = false;
    render(<Home />);
    expect(screen.getByText("Loading local presentations…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "+ New presentation" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    harness.store.ready = true;
    harness.store.projects = [];
    render(<Home />);
    expect(screen.getByText(/No presentations yet/)).toBeTruthy();
  });

  it("toggles the home form and submits a custom titled presentation", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "+ New presentation" }));
    fireEvent.change(screen.getByPlaceholderText("We’ll use today’s date if you skip this"), { target: { value: "  Talk  " } });
    fireEvent.click(screen.getByRole("button", { name: "Start presentation with audio" }));
    expect(harness.store.createProject).toHaveBeenCalledWith("Talk", "");
    expect(harness.store.createRecording).toHaveBeenCalled();
    expect(harness.router.push).toHaveBeenCalledWith("/recordings/created-recording/analyzing");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Start with your audio")).toBeNull();
  });

  it("renders project status rows and action links for complete, failed, and processing takes", () => {
    harness.store.recordings = [
      { ...recording("complete"), summary_metrics: { duration_seconds: 10, words_per_minute: 120, fillers_per_100_words: 1, pauses_per_speaking_minute: 2, rubric_scores: { speaking_rate: 3, filler_words: 3, pauses_inside_sentences: 3 } } },
      recording("failed", "FAILED"),
      recording("processing", "PROCESSING"),
      recording("local-complete", "COMPLETE"),
    ];
    render(<ProjectPage />);
    expect(screen.getByText("4 attempts · Created Jan 1, 2025")).toBeTruthy();
    expect(screen.getByText(/Local demo/)).toBeTruthy();
    expect(screen.getByText("Processing…")).toBeTruthy();
    expect(screen.getAllByText("Review →").map((node) => node.getAttribute("href"))).toEqual(["/recordings/local-complete", "/recordings/complete"]);
    expect(screen.getByText("Status →").getAttribute("href")).toBe("/recordings/processing/analyzing");
    expect(screen.getByTestId("charts").textContent).toContain("charts:4");
  });

  it("handles missing projects on project and new-attempt routes", () => {
    harness.params.projectId = "missing";
    harness.store.projects = [];
    render(<ProjectPage />);
    expect(screen.getByText("Presentation not found.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All presentations" }).getAttribute("href")).toBe("/");
    render(<NewAttemptPage />);
    expect(screen.getAllByText("Presentation not found.")).toHaveLength(2);
  });

  it("submits a new attempt for the current project and navigates to its status", () => {
    render(<NewAttemptPage />);
    expect(screen.getByRole("heading", { name: "Record or upload" })).toBeTruthy();
    expect(screen.getByText(/up to 100 MB/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Analyze demo recording" }));
    expect(harness.store.createRecording).toHaveBeenCalledWith("project-1", expect.any(Blob), "test.wav");
    expect(harness.router.push).toHaveBeenCalledWith("/recordings/created-recording/analyzing");
  });
});

describe("analyzing route", () => {
  it.each([
    ["AWAITING_UPLOAD", "Adding audio…"],
    ["PROCESSING", "Simulating timestamp alignment…"],
    ["TRANSCRIBING", "Simulating measurements…"],
    ["ANALYZED", "Simulating coaching stage…"],
  ] as const)("marks the current %s stage", (status, message) => {
    harness.store.recordings = [recording("recording-1", status)];
    render(<AnalyzingPage />);
    expect(screen.getByText(message).closest("li")?.getAttribute("aria-current")).toBe("step");
    expect(screen.queryByRole("link", { name: "See results →" })).toBeNull();
  });

  it("supports listening goals and completed local demo without analysis", () => {
    harness.store.recordings = [recording("recording-1", "COMPLETE")];
    render(<AnalyzingPage />);
    expect(screen.getByRole("heading", { name: "Demo processing complete" })).toBeTruthy();
    expect(screen.getByText(/no transcript or scores/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pace" }));
    expect(screen.getByText("Where did you give your audience time to absorb an idea?")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See results →" }).getAttribute("href")).toBe("/recordings/recording-1");
  });

  it.each([["FAILED", "Analysis failed"], ["DELETED", "Recording unavailable"], ["PURGE_PENDING", "Recording unavailable"]] as const)("renders %s status", (status, title) => {
    harness.store.recordings = [recording("recording-1", status)];
    render(<AnalyzingPage />);
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Analysis stages" })).toBeNull();
  });
});

describe("results route", () => {
  it("shows no-analysis messaging for a complete local recording", () => {
    render(<ResultsPage />);
    expect(screen.getByRole("heading", { name: "Your demo recording" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Analysis is not connected" })).toBeTruthy();
    expect(screen.queryByText("The transcript")).toBeNull();
    expect(screen.getByRole("link", { name: "Practice again →" }).getAttribute("href")).toBe("/projects/project-1/new");
  });

  it("renders review categories, transcript, and selected feedback moments", () => {
    harness.store.reviews = {
      "recording-1": {
        recording_id: "recording-1",
        transcript: { text: "Hello world.", items: [
          { type: "pronunciation", start_time: "0", end_time: "1", alternatives: [{ content: "Hello" }] },
          { type: "punctuation", alternatives: [{ content: "." }] },
        ] },
        analysis: { duration_seconds: 4, words_per_minute: 140, fillers_per_100_words: 1, pauses_per_speaking_minute: 2, rubric_scores: { speaking_rate: 4, filler_words: 4, pauses_inside_sentences: 3 }, filler_occurrences: [], pauses: [], long_pauses: [] },
        feedback: { feedback: "Keep the opening clear.", categories: { general: { observation: "Strong point", next_step: "Keep going" }, pace: { observation: "Good pace", next_step: "Pause once" } }, moments: [{ id: "m1", start_seconds: 0, end_seconds: 1, text: "Opening", kind: "strength", observation: "Clear", next_step: "Repeat" }] },
      },
    };
    render(<ResultsPage />);
    expect(screen.getByRole("heading", { name: "Your results" })).toBeTruthy();
    expect(screen.getAllByText("140 WPM")).toHaveLength(2);
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("General speech")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Strength" }));
    expect(screen.getByText("Clear")).toBeTruthy();
    expect(screen.getByText(/Repeat/)).toBeTruthy();
  });

  it("guards missing and incomplete recordings", () => {
    harness.params.recordingId = "unknown";
    render(<ResultsPage />);
    expect(screen.getByText("Recording not found.")).toBeTruthy();
    harness.params.recordingId = "recording-1";
    harness.store.recordings = [recording("recording-1", "PROCESSING")];
    render(<ResultsPage />);
    expect(screen.getByText("This recording is not ready yet.")).toBeTruthy();
  });
});
