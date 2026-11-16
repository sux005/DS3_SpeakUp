import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecorderUploader } from "@/components/RecorderUploader";

type FakeTrack = { stop: ReturnType<typeof vi.fn> };

class FakeRecorder {
  static supported = new Set<string>(["audio/webm;codecs=opus", "audio/webm"]);
  static isTypeSupported = vi.fn((type: string) => FakeRecorder.supported.has(type));
  static instances: FakeRecorder[] = [];
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  start = vi.fn(() => { this.state = "recording"; });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["chunk"], { type: this.mimeType }) });
    this.onstop?.();
  });

  constructor(public stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? this.mimeType;
    FakeRecorder.instances.push(this);
  }
}

function choose(file: File) {
  fireEvent.change(screen.getByLabelText("↑ Upload audio"), { target: { files: [file] } });
}

describe("RecorderUploader edge cases", () => {
  let tracks: FakeTrack[];
  let stream: { getTracks: () => FakeTrack[] };

  beforeEach(() => {
    vi.useFakeTimers();
    FakeRecorder.instances = [];
    FakeRecorder.supported = new Set(["audio/webm;codecs=opus", "audio/webm"]);
    FakeRecorder.isTypeSupported.mockClear();
    tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    stream = { getTracks: () => tracks };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeRecorder });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:${Math.random()}`) });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("captures microphone chunks, chooses the supported MIME type, and submits the recording", async () => {
    const onSubmit = vi.fn();
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={onSubmit} />);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "● Record audio" })); });
    expect(screen.getByText("RECORDING 00:00 / 00:10")).toBeTruthy();
    expect(FakeRecorder.instances).toHaveLength(1);
    expect(FakeRecorder.instances[0].mimeType).toBe("audio/webm;codecs=opus");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "■ Stop recording" })); });
    expect(tracks.every((track) => track.stop).valueOf()).toBeTruthy();
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(screen.getByText(/READY · speakup-recording-/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Analyze demo recording" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toBeInstanceOf(Blob);
  });

  it("falls back to audio/mp4 when webm is unavailable", async () => {
    FakeRecorder.supported = new Set(["audio/mp4"]);
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "● Record audio" })); });
    expect(FakeRecorder.instances[0].mimeType).toBe("audio/mp4");
  });

  it("automatically stops at the configured duration", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={1} onSubmit={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "● Record audio" })); });
    await act(async () => { vi.advanceTimersByTime(1_250); });
    expect(FakeRecorder.instances[0].stop).toHaveBeenCalledOnce();
    expect(screen.getByText(/READY · speakup-recording-/)).toBeTruthy();
  });

  it("revokes the previous preview when replacing a file", () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    choose(new File(["one"], "one.wav", { type: "audio/wav" }));
    const firstUrl = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    choose(new File(["two"], "two.wav", { type: "audio/wav" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    expect(screen.getByText("READY · two.wav")).toBeTruthy();
  });

  it("stops an active stream and revokes the preview on unmount", async () => {
    const view = render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "● Record audio" })); });
    view.unmount();
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  });
});
