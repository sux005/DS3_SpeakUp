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

async function beginRecording() {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "● Record audio" })); });
  await act(async () => { vi.advanceTimersByTime(3000); });
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

  it("drives the level meter from the real microphone stream and clears it on stop", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn();
    class FakeAudioContext {
      createAnalyser = () => ({ fftSize: 0, getByteTimeDomainData: (samples: Uint8Array) => samples.fill(160) });
      createMediaStreamSource = vi.fn(() => ({ connect }));
      close = close;
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    const { container } = render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    const bars = () => [...container.querySelectorAll<HTMLElement>('[aria-hidden="true"] > span')];

    await beginRecording();
    expect(connect).toHaveBeenCalledOnce();
    expect(screen.getByText("Live level from your microphone.")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(170); });
    // Two readings so far: the newest bars carry the measured level, older ones stay flat.
    expect(bars().at(-1)!.style.height).toBe("100%");
    expect(bars().at(-2)!.style.height).toBe("100%");
    expect(bars()[0].style.height).toBe("0%");

    // A reading can land between the recorder stopping and the meter's timer being
    // cleared. Stop the recorder without letting React re-render, then tick once.
    const recorder = FakeRecorder.instances[0];
    await act(async () => {
      recorder.stop();
      vi.advanceTimersByTime(90);
    });
    expect(close).toHaveBeenCalledOnce();
    expect(bars().every((bar) => bar.style.height === "0%")).toBe(true);
    expect(screen.getByText("The level meter moves while you record.")).toBeTruthy();
    Reflect.deleteProperty(window, "AudioContext");
  });

  it("still records when the browser cannot set up the level meter", async () => {
    Object.defineProperty(window, "AudioContext", { configurable: true, value: class { constructor() { throw new Error("no audio"); } } });
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    expect(screen.getByText("RECORDING 00:00 / 00:10")).toBeTruthy();
    expect(screen.getByText("The level meter moves while you record.")).toBeTruthy();
    Reflect.deleteProperty(window, "AudioContext");
  });

  it("captures microphone chunks, chooses the supported MIME type, and submits the recording", async () => {
    const onSubmit = vi.fn();
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={onSubmit} />);

    await beginRecording();
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

    await beginRecording();
    expect(FakeRecorder.instances[0].mimeType).toBe("audio/mp4");
  });

  it("can cancel the countdown without saving microphone audio", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "● Record audio" })); });
    expect(screen.getByText("Recording starts in 3…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel countdown" }));
    await act(async () => { vi.advanceTimersByTime(3000); });

    expect(FakeRecorder.instances[0].start).not.toHaveBeenCalled();
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(screen.getByRole("button", { name: "● Record audio" })).toBeTruthy();
  });

  it("automatically stops at the configured duration", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={1} onSubmit={vi.fn()} />);
    await beginRecording();
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
    await beginRecording();
    view.unmount();
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  });
});
