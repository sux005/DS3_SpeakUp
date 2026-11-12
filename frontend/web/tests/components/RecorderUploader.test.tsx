import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecorderUploader } from "@/components/RecorderUploader";

const createObjectURL = vi.fn(() => "blob:preview");
const revokeObjectURL = vi.fn();

function choose(file: File) {
  fireEvent.change(screen.getByLabelText("↑ Upload audio"), { target: { files: [file] } });
}

describe("RecorderUploader", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a supported audio file, previews it, and submits the original payload", async () => {
    const onSubmit = vi.fn();
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={90} onSubmit={onSubmit} />);
    const file = new File([new Uint8Array([1, 2, 3])], "pitch.wav", { type: "audio/wav" });

    choose(file);

    expect(await screen.findByText("READY · pitch.wav")).toBeTruthy();
    expect(screen.getByLabelText("Preview selected audio").getAttribute("src")).toBe("blob:preview");
    fireEvent.click(screen.getByRole("button", { name: "Analyze demo recording" }));
    expect(onSubmit).toHaveBeenCalledWith(file, "pitch.wav");
  });

  it.each([
    ["notes.txt", "text/plain"],
    ["voice.aac", "audio/aac"],
  ])("rejects unsupported file %s", async (name, type) => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={90} onSubmit={vi.fn()} />);
    choose(new File(["bad"], name, { type }));

    expect((await screen.findByRole("alert")).textContent).toContain("Choose a WAV, MP3, M4A, or WebM audio file.");
    expect(screen.queryByText(new RegExp(`READY.*${name}`))).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects an oversized file and keeps the submit action hidden", async () => {
    render(<RecorderUploader maxAudioBytes={4} maxAudioDurationSeconds={90} onSubmit={vi.fn()} />);
    choose(new File([new Uint8Array(5)], "large.mp3", { type: "audio/mpeg" }));

    expect((await screen.findByRole("alert")).textContent).toContain("That file is too large");
    expect(screen.queryByRole("button", { name: "Analyze demo recording" })).toBeNull();
  });

  it("clears a selected file, preview, and filename when discarded", async () => {
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={90} onSubmit={vi.fn()} />);
    choose(new File(["audio"], "discard.webm", { type: "audio/webm" }));
    await screen.findByText("READY · discard.webm");

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.getByText("DEMO ONLY · Nothing is sent to AWS")).toBeTruthy();
    expect(screen.queryByLabelText("Preview selected audio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Analyze demo recording" })).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("reports unsupported microphone APIs instead of throwing", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: undefined });
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={90} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "● Record audio" }));

    expect((await screen.findByRole("alert")).textContent).toContain("does not support microphone recording");
  });

  it("handles microphone permission denial with an actionable error", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: vi.fn() });
    render(<RecorderUploader maxAudioBytes={1024} maxAudioDurationSeconds={90} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "● Record audio" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Microphone access was unavailable"));
  });
});
