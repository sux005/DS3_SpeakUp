import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioReviewPlayer, type ReviewMoment } from "@/components/AudioReviewPlayer";

const moments: ReviewMoment[] = [
  { id: "m1", at: 2, label: "Strong opening", observation: "Clear" },
  { id: "m2", at: 8, label: "Try a pause" },
];

describe("AudioReviewPlayer", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
  });

  afterEach(() => vi.restoreAllMocks());

  it("renders the unavailable state and keeps playback controls disabled", () => {
    render(<AudioReviewPlayer moments={moments} />);

    expect(screen.getByText("Audio preview unavailable in demo data.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Play recording" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("slider", { name: "Recording position" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Strong opening/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /Try a pause/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("plays, pauses, reports time, and stops when the media ends", async () => {
    const onTimeChange = vi.fn();
    render(<AudioReviewPlayer audioUrl="blob:audio" durationSeconds={12} moments={[]} onTimeChange={onTimeChange} />);
    const audio = document.querySelector("audio")!;

    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause recording" })).toBeTruthy());
    Object.defineProperty(audio, "currentTime", { configurable: true, value: 4 });
    fireEvent(audio, new Event("timeupdate"));
    expect(onTimeChange).toHaveBeenCalledWith(4);
    expect(screen.getByText("00:04 / 00:12")).toBeTruthy();

    fireEvent(audio, new Event("ended"));
    expect(screen.getByRole("button", { name: "Play recording" })).toBeTruthy();
  });

  it("clamps slider seeks and invokes moment callbacks", () => {
    const onTimeChange = vi.fn();
    const onMomentSelect = vi.fn();
    render(
      <AudioReviewPlayer
        audioUrl="blob:audio"
        durationSeconds={10}
        moments={moments}
        onTimeChange={onTimeChange}
        onMomentSelect={onMomentSelect}
      />,
    );
    const audio = document.querySelector("audio")!;
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 0 });
    const slider = screen.getByRole("slider", { name: "Recording position" });
    fireEvent.change(slider, { target: { value: "99" } });
    expect(audio.currentTime).toBe(10);
    expect(onTimeChange).toHaveBeenCalledWith(10);

    fireEvent.click(screen.getByRole("button", { name: /Strong opening/ }));
    expect(audio.currentTime).toBe(2);
    expect(onMomentSelect).toHaveBeenCalledWith(moments[0]);
  });

  it("surfaces a playback rejection without crashing", async () => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockRejectedValue(new Error("blocked")) });
    render(<AudioReviewPlayer audioUrl="blob:audio" durationSeconds={4} moments={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Playback was blocked");
    expect(screen.getByRole("button", { name: "Play recording" })).toBeTruthy();
  });

  it("updates duration from loaded metadata and reports media errors", async () => {
    render(<AudioReviewPlayer audioUrl="blob:audio" durationSeconds={0} moments={[]} />);
    const audio = document.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { configurable: true, value: 7.5 });
    fireEvent(audio, new Event("loadedmetadata"));
    expect(screen.getByText("00:00 / 00:07")).toBeTruthy();
    fireEvent(audio, new Event("error"));
    expect((await screen.findByRole("alert")).textContent).toContain("could not be loaded");
  });
});
