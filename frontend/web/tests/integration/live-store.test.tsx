import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjects: vi.fn(),
  getProjectRecordings: vi.fn(),
  getAccountLimits: vi.fn(),
  createProject: vi.fn(),
  reserveAndUploadRecording: vi.fn(),
  getRecording: vi.fn(),
  loadRecordingReview: vi.fn(),
  getDownloadUrl: vi.fn(),
}));

vi.mock("@/lib/demo-store", () => ({ useDemoStore: () => ({ projects: [], recordings: [], reviews: {}, audioUrls: {}, ready: true, limits: {} }) }));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error { constructor(public status: number, public code: string | undefined, message: string) { super(message); } },
  getProjects: mocks.getProjects,
  getProjectRecordings: mocks.getProjectRecordings,
  getAccountLimits: mocks.getAccountLimits,
  createProject: mocks.createProject,
  reserveAndUploadRecording: mocks.reserveAndUploadRecording,
  getRecording: mocks.getRecording,
  loadRecordingReview: mocks.loadRecordingReview,
  getDownloadUrl: mocks.getDownloadUrl,
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SPEAKUP_API_URL", "/api/speakup");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  for (const mock of Object.values(mocks)) if ("mockReset" in mock) mock.mockReset();
  mocks.getProjects.mockResolvedValue({ items: [{ project_id: "p1", project_title: "Live project", description: "", created_at: "2025-01-01T00:00:00Z" }] });
  mocks.getProjectRecordings.mockResolvedValue({ items: [] });
  mocks.getAccountLimits.mockResolvedValue({ max_audio_upload_bytes: 1000, max_audio_duration_seconds: 60 });
  mocks.getRecording.mockResolvedValue({ project_id: "p1", recording_id: "r1", created_at: "2025-01-02T00:00:00Z", status: "PROCESSING" });
  mocks.createProject.mockResolvedValue({ project_id: "p2", project_title: "New", description: "", created_at: "2025-01-03T00:00:00Z" });
  mocks.reserveAndUploadRecording.mockResolvedValue("r1");
  mocks.loadRecordingReview.mockResolvedValue({ recording_id: "r1", transcript: { text: "Hello", items: [] }, feedback: null, analysis: { words_per_minute: 120 } });
  mocks.getDownloadUrl.mockResolvedValue({ download_url: "https://s3.example.test/audio" });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("live store API handoff", () => {
  it("loads owner projects and limits from the API and creates a backend recording", async () => {
    const { LiveProvider, useAppStore } = await import("@/lib/live-store");
    function Probe() {
      const store = useAppStore();
      return <>
        <output data-testid="projects">{store.projects.map((item) => item.project_title).join(",")}</output>
        <output data-testid="recordings">{store.recordings.map((item) => item.recording_id).join(",")}</output>
        <output data-testid="limit">{store.limits.max_audio_upload_bytes}</output>
        <button onClick={() => void store.createRecording("p1", new Blob(["audio"], { type: "audio/wav" }), "talk.wav")}>Upload</button>
      </>;
    }
    render(<LiveProvider><Probe /></LiveProvider>);
    await waitFor(() => expect(screen.getByTestId("projects").textContent).toBe("Live project"));
    expect(screen.getByTestId("limit").textContent).toBe("1000");
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(screen.getByTestId("recordings").textContent).toBe("r1"));
    expect(mocks.reserveAndUploadRecording).toHaveBeenCalledWith("", "p1", expect.any(File), undefined, expect.any(String));
  });

  it("hydrates review and signed audio URL for the requested recording", async () => {
    const { LiveProvider, useAppStore } = await import("@/lib/live-store");
    function Probe() {
      const store = useAppStore();
      return <>
        <output data-testid="review">{store.reviews.r1?.transcript.text ?? ""}</output>
        <output data-testid="audio">{store.audioUrls.r1 ?? ""}</output>
        <button onClick={() => { void store.loadReview("r1"); void store.loadAudio("r1"); }}>Load results</button>
      </>;
    }
    render(<LiveProvider><Probe /></LiveProvider>);
    await waitFor(() => expect(mocks.getProjects).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Load results" }));
    await waitFor(() => expect(screen.getByTestId("review").textContent).toBe("Hello"));
    expect(screen.getByTestId("audio").textContent).toBe("https://s3.example.test/audio");
  });

  it("loads paginated projects, creates a project, and refreshes a recording", async () => {
    mocks.getProjects.mockReset().mockResolvedValueOnce({ items: [{ project_id: "p1", project_title: "First", description: "", created_at: "2025-01-01T00:00:00Z" }], next_cursor: "next" }).mockResolvedValueOnce({ items: [{ project_id: "p2", project_title: "Second", description: "", created_at: "2025-01-02T00:00:00Z" }] });
    const { LiveProvider, useAppStore } = await import("@/lib/live-store");
    function Probe() {
      const store = useAppStore();
      return <>
        <output data-testid="projects">{store.projects.map((item) => item.project_title).join(",")}</output>
        <output data-testid="recordings">{store.recordings.map((item) => item.recording_id).join(",")}</output>
        <button onClick={() => void store.createProject("New", "")}>Create</button>
        <button onClick={() => void store.refreshRecording("r1")}>Refresh recording</button>
      </>;
    }
    render(<LiveProvider><Probe /></LiveProvider>);
    await waitFor(() => expect(screen.getByTestId("projects").textContent).toBe("First,Second"));
    expect(mocks.getProjects.mock.calls.map((call) => call[1])).toEqual([undefined, "next"]);
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.getByTestId("projects").textContent).toContain("New"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh recording" }));
    await waitFor(() => expect(screen.getByTestId("recordings").textContent).toBe("r1"));
  });

  it("reuses an idempotency key when retrying one failed upload", async () => {
    mocks.reserveAndUploadRecording.mockRejectedValueOnce(new Error("S3 unavailable")).mockResolvedValueOnce("r1");
    const { LiveProvider, useAppStore } = await import("@/lib/live-store");
    const audio = new Blob(["audio"], { type: "audio/wav" });
    const failures: string[] = [];
    function Probe() {
      const store = useAppStore();
      return <>
        <output data-testid="error">{store.error}</output>
        <button onClick={() => { void Promise.resolve(store.createRecording("p1", audio, "talk.wav")).catch((error: Error) => failures.push(error.message)); }}>Upload</button>
      </>;
    }
    render(<LiveProvider><Probe /></LiveProvider>);
    await waitFor(() => expect(mocks.getProjects).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("S3 unavailable"));
    expect(failures).toEqual(["S3 unavailable"]);
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(mocks.reserveAndUploadRecording).toHaveBeenCalledTimes(2));
    const keys = mocks.reserveAndUploadRecording.mock.calls.map((call) => call[4]);
    expect(keys[0]).toBe(keys[1]);
  });

  it("does not load project data when the local guest session fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    const { LiveProvider, useAppStore } = await import("@/lib/live-store");
    function Probe() {
      const store = useAppStore();
      return <output data-testid="state">{`${store.ready}:${store.projects.length}:${store.error}`}</output>;
    }
    render(<LiveProvider><Probe /></LiveProvider>);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("true:0:The local analysis session could not start."));
    expect(mocks.getProjects).not.toHaveBeenCalled();
  });

});
