import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  push: vi.fn(),
  createRecording: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "project-1" }),
  useRouter: () => ({ push: harness.push }),
}));
vi.mock("@/lib/live-store", () => ({
  useAppStore: () => ({
    projects: [{ project_id: "project-1", project_title: "Practice talk", description: "", created_at: "2026-01-01T00:00:00Z" }],
    limits: { max_audio_upload_bytes: 1024, max_audio_duration_seconds: 60 },
    ready: true,
    createRecording: harness.createRecording,
    error: null,
    live: true,
  }),
}));
vi.mock("@/components/PageHeading", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  PageHeading: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/MascotCoach", () => ({
  MascotCoach: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import NewAttemptPage from "@/app/projects/[projectId]/new/page";

class FakeRecorder {
  static isTypeSupported = () => true;
  static latest: FakeRecorder;
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;

  constructor() { FakeRecorder.latest = this; }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["recorded audio"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

class FakeRecognition {
  static latest: FakeRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = "";
  onresult?: (event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void;
  onerror?: (event: { error: string }) => void;
  onend?: () => void;

  constructor() { FakeRecognition.latest = this; }
  start() {}
  stop() {}
  say(words: string, isFinal: boolean) {
    this.onresult?.({ results: [{ isFinal, 0: { transcript: words } }] });
  }
}

describe("new attempt live recording", () => {
  beforeEach(() => {
    FakeRecognition.latest = null;
    harness.push.mockReset();
    harness.createRecording.mockReset().mockResolvedValue("recording-1");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
    });
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeRecorder });
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("shows live words and submits the completed recording through the page", async () => {
    vi.useFakeTimers();
    render(<NewAttemptPage />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "● Record audio" })); });
    expect(harness.createRecording).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(harness.createRecording).not.toHaveBeenCalled();

    await act(async () => { FakeRecognition.latest!.say("hello there", false); });
    expect(screen.getByLabelText("Live transcript").textContent).toContain("hello there");
    await act(async () => { FakeRecognition.latest!.say("hello there", true); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "■ Stop recording" })); });
    expect(screen.getByLabelText("Live transcript").textContent).toContain("hello there");
    expect(harness.createRecording).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start presentation with audio" }));
    await act(async () => { await Promise.resolve(); });
    expect(harness.createRecording).toHaveBeenCalledWith(
      "project-1", expect.any(Blob), expect.stringMatching(/^speakup-recording-.*\.webm$/),
    );
    expect(harness.push).toHaveBeenCalledWith("/recordings/recording-1/analyzing");
  });

  it("uploads a selected file without starting live recognition", async () => {
    render(<NewAttemptPage />);
    const file = new File(["audio"], "speech.wav", { type: "audio/wav" });
    fireEvent.change(screen.getByLabelText("↑ Upload audio"), { target: { files: [file] } });
    expect(harness.createRecording).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start presentation with audio" }));

    await waitFor(() => expect(harness.createRecording).toHaveBeenCalledWith("project-1", file, "speech.wav"));
    expect(FakeRecognition.latest).toBeNull();
  });
});
