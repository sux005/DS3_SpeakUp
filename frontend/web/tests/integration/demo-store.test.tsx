import { act, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DemoProvider, useDemoStore } from "@/lib/demo-store";

function Probe() {
  const store = useDemoStore();
  const latest = store.recordings[store.recordings.length - 1];
  return (
    <div>
      <output data-testid="ready">{String(store.ready)}</output>
      <output data-testid="project-count">{store.projects.length}</output>
      <output data-testid="recording-count">{store.recordings.length}</output>
      <output data-testid="latest-status">{latest?.status ?? "none"}</output>
      <output data-testid="latest-audio">{latest?.audio_name ?? "none"}</output>
      <output data-testid="latest-url">{latest ? store.audioUrls[latest.recording_id] ?? "missing" : "none"}</output>
      <button onClick={() => store.createProject("  New talk  ", "  Notes  ")}>create project</button>
      <button onClick={() => store.createRecording("project-test", new Blob(["audio"], { type: "audio/wav" }), "voice.wav")}>create recording</button>
    </div>
  );
}

function renderStore() {
  return render(<DemoProvider><Probe /></DemoProvider>);
}

async function waitForReady() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByTestId("ready").textContent).toBe("true");
}

describe("DemoProvider", () => {
  let originalCreateObjectURL: typeof URL.createObjectURL | undefined;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.spyOn(crypto, "randomUUID").mockReturnValue("test-id");
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: vi.fn(() => "blob:test") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: vi.fn() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalCreateObjectURL) Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: originalCreateObjectURL });
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: originalRevokeObjectURL });
    else Reflect.deleteProperty(URL, "revokeObjectURL");
    vi.useRealTimers();
  });

  it("hydrates the seeded demo and marks the provider ready asynchronously", async () => {
    renderStore();
    expect(screen.getByTestId("ready").textContent).toBe("false");
    await waitForReady();
    expect(Number(screen.getByTestId("project-count").textContent)).toBeGreaterThan(0);
    expect(Number(screen.getByTestId("recording-count").textContent)).toBeGreaterThan(0);
  });

  it("ignores malformed localStorage and still opens the demo", async () => {
    localStorage.setItem("speakup-frontend-demo-v1", "not-json");
    renderStore();
    await waitForReady();
    expect(screen.getByTestId("recording-count").textContent).not.toBe("0");
  });

  it("restores a valid state and normalizes a stale transcribing recording", async () => {
    localStorage.setItem("speakup-frontend-demo-v1", JSON.stringify({
      projects: [],
      recordings: [{ project_id: "p", recording_id: "r", created_at: "2025-01-01T00:00:00.000Z", status: "TRANSCRIBING" }],
      reviews: {},
    }));
    renderStore();
    await waitForReady();
    expect(screen.getByTestId("latest-status").textContent).toBe("TRANSCRIBING");
    expect(JSON.parse(localStorage.getItem("speakup-frontend-demo-v1") ?? "{}").recordings[0].demo_started_at).toBeTypeOf("number");
  });

  it("creates trimmed projects and local audio recordings", async () => {
    renderStore();
    await waitForReady();
    const projectCount = Number(screen.getByTestId("project-count").textContent);
    await act(async () => { screen.getByRole("button", { name: "create project" }).click(); });
    expect(Number(screen.getByTestId("project-count").textContent)).toBe(projectCount + 1);
    await act(async () => { screen.getByRole("button", { name: "create recording" }).click(); });
    expect(screen.getByTestId("latest-status").textContent).toBe("PROCESSING");
    expect(screen.getByTestId("latest-audio").textContent).toBe("voice.wav");
    expect(screen.getByTestId("latest-url").textContent).toBe("blob:test");
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });

  it("advances local processing through each timed stage", async () => {
    renderStore();
    await waitForReady();
    await act(async () => { screen.getByRole("button", { name: "create recording" }).click(); });
    expect(screen.getByTestId("latest-status").textContent).toBe("PROCESSING");
    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(screen.getByTestId("latest-status").textContent).toBe("TRANSCRIBING");
    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(screen.getByTestId("latest-status").textContent).toBe("ANALYZED");
    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(screen.getByTestId("latest-status").textContent).toBe("COMPLETE");
  });

  it("revokes created object URLs when the provider unmounts", async () => {
    const view = renderStore();
    await waitForReady();
    await act(async () => { screen.getByRole("button", { name: "create recording" }).click(); });
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
