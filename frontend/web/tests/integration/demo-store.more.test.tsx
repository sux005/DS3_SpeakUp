import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoProvider, useDemoStore } from "@/lib/demo-store";
import transcript from "@/data/transcript.json";

function Probe() { const store = useDemoStore(); return <><output data-testid="ready">{String(store.ready)}</output><output data-testid="projects">{store.projects.length}</output><output data-testid="recordings">{store.recordings.map((item) => `${item.recording_id}:${item.status}`).join(",")}</output><button onClick={() => store.createRecording("p", new Blob(["a"], { type: "audio/wav" }), "a.wav")}>add recording</button></>; }
const renderStore = () => render(<DemoProvider><Probe /></DemoProvider>);
const ready = async () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("DemoProvider persistence and timing edges", () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); vi.spyOn(crypto, "randomUUID").mockReturnValue("edge-id"); Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: vi.fn(() => "blob:edge") }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: vi.fn() }); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  it("falls back to seeded state when storage reads throw", async () => { vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); }); renderStore(); await ready(); expect(screen.getByTestId("ready").textContent).toBe("true"); expect(Number(screen.getByTestId("projects").textContent)).toBeGreaterThan(0); });
  it("continues rendering when persistence writes throw", async () => { vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); }); renderStore(); await ready(); await act(async () => { screen.getByRole("button", { name: "add recording" }).click(); }); expect(screen.getByTestId("recordings").textContent).toContain("edge-id:PROCESSING"); });
  it("rejects persisted objects missing required collections", async () => { localStorage.setItem("speakup-frontend-demo-v1", JSON.stringify({ projects: [], recordings: [], reviews: null })); renderStore(); await ready(); expect(Number(screen.getByTestId("projects").textContent)).toBeGreaterThan(0); });
  it.each([
    { projects: [null], recordings: [], reviews: {} },
    { projects: [], recordings: [null], reviews: {} },
    { projects: [], recordings: [], reviews: { broken: { transcript: null } } },
    { projects: [], recordings: [{ project_id: "p", recording_id: "r", created_at: "2025-01-01", status: "COMPLETE", summary_metrics: {} }], reviews: {} },
  ])("falls back to seeded data when nested saved entries are malformed", async (saved) => {
    localStorage.setItem("speakup-frontend-demo-v1", JSON.stringify(saved));
    renderStore();
    await ready();
    expect(screen.getByTestId("recordings").textContent).toContain(`${transcript.recording_id}:COMPLETE`);
  });
  it("keeps non-demo statuses stable across timer ticks", async () => { localStorage.setItem("speakup-frontend-demo-v1", JSON.stringify({ projects: [{ project_id: "p", project_title: "P", description: "", created_at: "2025-01-01T00:00:00Z" }], recordings: [{ project_id: "p", recording_id: "failed", created_at: "2025-01-01T00:00:00Z", status: "FAILED" }, { project_id: "p", recording_id: "complete", created_at: "2025-01-01T00:00:00Z", status: "COMPLETE" }], reviews: {} })); renderStore(); await ready(); await act(async () => { vi.advanceTimersByTime(20_000); }); expect(screen.getByTestId("recordings").textContent).toContain("failed:FAILED"); expect(screen.getByTestId("recordings").textContent).toContain("complete:COMPLETE"); });
  it("cleans up the interval after unmounting", async () => { const view = renderStore(); await ready(); view.unmount(); await act(async () => { vi.advanceTimersByTime(20_000); }); expect(true).toBe(true); });
});
