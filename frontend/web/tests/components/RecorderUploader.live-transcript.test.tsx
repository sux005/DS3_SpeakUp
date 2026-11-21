import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecorderUploader } from "@/components/RecorderUploader";

type ResultHandler = (event: {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}) => void;

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = vi.fn(() => true);
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  start = vi.fn(() => { this.state = "recording"; });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
    this.onstop?.();
  });

  constructor(public stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? this.mimeType;
    FakeRecorder.instances.push(this);
  }
}

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  onresult?: ResultHandler;
  onerror?: (event: { error: string }) => void;
  onend?: () => void;
  start = vi.fn(() => undefined);
  stop = vi.fn(() => undefined);

  constructor() {
    FakeRecognition.instances.push(this);
  }

  emitResult(transcript: string, isFinal = false) {
    this.emitResults([{ transcript, isFinal }]);
  }

  emitResults(results: Array<{ transcript: string; isFinal: boolean }>) {
    this.onresult?.({
      resultIndex: 0,
      results: results.map(({ transcript, isFinal }) => ({ isFinal, 0: { transcript } })),
    });
  }
}

function installRecordingMocks() {
  const tracks = [{ stop: vi.fn() }];
  const stream = { getTracks: () => tracks };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeRecorder });
  Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: FakeRecognition });
  Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
}

async function beginRecording(label = "● Record audio") {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: label }));
  });
  await act(async () => { vi.advanceTimersByTime(3000); });
}

describe("RecorderUploader live transcript", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) { this.removeAttribute("open"); },
    });
    FakeRecorder.instances = [];
    FakeRecognition.instances = [];
    FakeRecorder.isTypeSupported.mockClear();
    installRecordingMocks();
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows 3, 2, 1 before starting the recorder and transcript", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "● Record audio" })));
    const recorder = FakeRecorder.instances[0];
    expect(screen.getByText("Recording starts in 3…")).toBeTruthy();
    expect(recorder.start).not.toHaveBeenCalled();
    expect(FakeRecognition.instances).toHaveLength(0);

    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("Recording starts in 2…")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("Recording starts in 1…")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(recorder.start).toHaveBeenCalledOnce();
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(screen.getByText("RECORDING 00:00 / 00:10")).toBeTruthy();
  });

  it("shows interim words while the microphone is recording", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);

    await beginRecording();
    await act(async () => {
      FakeRecognition.instances[0].emitResult("hello everyone");
    });

    expect(screen.getByText("hello everyone")).toBeTruthy();
  });

  it("tracks interim fillers immediately and does not double-count them when finalized", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    const recognition = FakeRecognition.instances[0];

    await act(async () => recognition.emitResult("um"));
    expect(screen.getByLabelText("1 estimated filler words")).toBeTruthy();
    expect(screen.getByText("Includes 1 provisional filler")).toBeTruthy();

    await act(async () => recognition.emitResult("um hello"));
    expect(screen.getByLabelText("1 estimated filler words")).toBeTruthy();

    await act(async () => recognition.emitResult("um hello", true));
    expect(screen.getByLabelText("1 estimated filler words")).toBeTruthy();
    expect(screen.queryByText("Includes 1 provisional filler")).toBeNull();
  });

  it("revises a provisional filler when recognition changes its guess", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    const recognition = FakeRecognition.instances[0];

    await act(async () => recognition.emitResult("um"));
    expect(screen.getByLabelText("1 estimated filler words")).toBeTruthy();
    await act(async () => recognition.emitResult("I'm"));
    expect(screen.getByLabelText("0 estimated filler words")).toBeTruthy();
  });

  it("keeps final words when a later interim result changes", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    const recognition = FakeRecognition.instances[0];

    await act(async () => {
      recognition.emitResult("hello", true);
      recognition.emitResults([
        { transcript: "hello", isFinal: true },
        { transcript: " everyone", isFinal: false },
      ]);
    });

    expect(screen.getByText(/hello/)).toBeTruthy();
    expect(screen.getByText(/everyone/)).toBeTruthy();
  });

  it("retains the transcript after recording stops", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    await act(async () => {
      FakeRecognition.instances[0].emitResult("this is my recording", true);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "■ Stop recording" }));
    });

    expect(screen.getByText(/this is my recording/)).toBeTruthy();
  });

  it("offers Record again and clears the previous take when the new one starts", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    await act(async () => FakeRecognition.instances[0].emitResult("first take", true));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "■ Stop recording" })));

    expect(screen.getByRole("button", { name: "● Record again" })).toBeTruthy();
    expect(screen.getByLabelText("Preview selected audio")).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "● Record again" })));
    expect(screen.getByRole("dialog", { name: "Record again?" })).toBeTruthy();
    expect(screen.getByText(/cannot be recovered/)).toBeTruthy();
    expect(FakeRecorder.instances).toHaveLength(1);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Record again$/ })));
    expect(screen.getByLabelText("Preview selected audio")).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(FakeRecorder.instances).toHaveLength(2);
    expect(screen.getByRole("button", { name: "■ Stop recording" })).toBeTruthy();
    expect(screen.queryByLabelText("Preview selected audio")).toBeNull();
    expect(screen.queryByText("first take")).toBeNull();
  });

  it("keeps the current take when the confirmation is cancelled", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "■ Stop recording" })));

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "● Record again" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Keep recording" })));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Preview selected audio")).toBeTruthy();
    expect(FakeRecorder.instances).toHaveLength(1);
  });

  it("keeps the take when the native dialog is cancelled or closed", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "■ Stop recording" })));

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "● Record again" })));
    await act(async () => fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true })));
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "● Record again" })));
    await act(async () => fireEvent(screen.getByRole("dialog"), new Event("close")));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Preview selected audio")).toBeTruthy();
    expect(FakeRecorder.instances).toHaveLength(1);
  });

  it("does not remember the preference when the confirmation is cancelled", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "■ Stop recording" })));

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "● Record again" })));
    fireEvent.click(screen.getByRole("checkbox", { name: "Don’t show again" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Keep recording" })));

    expect(window.localStorage.getItem("speakup-skip-record-again-confirmation")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "● Record again" })));
    expect(screen.getByRole("dialog", { name: "Record again?" })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Don’t show again" }) as HTMLInputElement).checked).toBe(false);
  });

  it("keeps the previous take if a confirmed countdown is cancelled", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "■ Stop recording" })));

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "● Record again" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Record again$/ })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel countdown" })));
    await act(async () => { vi.advanceTimersByTime(3000); });

    expect(FakeRecorder.instances[1].start).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Preview selected audio")).toBeTruthy();
    expect(screen.getByRole("button", { name: "● Record again" })).toBeTruthy();
  });

  it("does not submit audio during capture, preview, confirmation, or a cancelled retake", async () => {
    const onSubmit = vi.fn();
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={onSubmit} submitLabel="Start presentation with audio" />);

    await beginRecording();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "■ Stop recording" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "● Record again" })));
    fireEvent.click(screen.getByRole("checkbox", { name: "Don’t show again" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Record again$/ })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel countdown" })));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Preview selected audio")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start presentation with audio" })));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("remembers the do not show again choice for later takes", async () => {
    const view = render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "■ Stop recording" })));

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "● Record again" })));
    fireEvent.click(screen.getByRole("checkbox", { name: "Don’t show again" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /^Record again$/ })));
    expect(window.localStorage.getItem("speakup-skip-record-again-confirmation")).toBe("true");
    view.unmount();

    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "■ Stop recording" })));

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "● Record again" })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(FakeRecorder.instances).toHaveLength(4);
    expect(screen.getByLabelText("Preview selected audio")).toBeTruthy();
  });

  it("restarts recognition without losing words from an earlier session", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    const recognition = FakeRecognition.instances[0];
    await act(async () => {
      recognition.emitResult("first thought", true);
      recognition.onend?.();
      vi.advanceTimersByTime(300);
      recognition.emitResult("second thought", true);
    });

    expect(recognition.start).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/first thought second thought/)).toBeTruthy();
  });

  it("clears the live transcript when the recording is discarded", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    await act(async () => {
      FakeRecognition.instances[0].emitResult("discard this", true);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "■ Stop recording" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.queryByText(/discard this/)).toBeNull();
    await act(async () => {
      FakeRecognition.instances[0].emitResult("late words", true);
    });
    expect(screen.queryByText(/late words/)).toBeNull();
  });

  it("continues recording when speech recognition is unavailable", async () => {
    Reflect.deleteProperty(window, "SpeechRecognition");
    Reflect.deleteProperty(window, "webkitSpeechRecognition");
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);

    await beginRecording();

    expect(screen.getByText("RECORDING 00:00 / 00:10")).toBeTruthy();
    expect(screen.getByText(/live transcript/i)).toBeTruthy();
  });

  it("keeps capturing audio when browser speech recognition fails", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={vi.fn()} />);
    await beginRecording();
    await act(async () => FakeRecognition.instances[0].onerror?.({ error: "network" }));

    expect(FakeRecorder.instances[0].state).toBe("recording");
    expect(screen.getByText(/Live transcription stopped/)).toBeTruthy();
  });

  it("keeps audio unsubmitted if the recorder cannot start after the countdown", async () => {
    const onSubmit = vi.fn();
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={10} onSubmit={onSubmit} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "● Record audio" })));
    FakeRecorder.instances[0].start.mockImplementationOnce(() => { throw new Error("microphone lost"); });
    await act(async () => { vi.advanceTimersByTime(3000); });

    expect(screen.getByRole("alert").textContent).toContain("Recording could not start");
    expect(screen.getByRole("button", { name: "● Record audio" })).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
