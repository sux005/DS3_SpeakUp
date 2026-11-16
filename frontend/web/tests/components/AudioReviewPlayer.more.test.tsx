import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioReviewPlayer } from "@/components/AudioReviewPlayer";

describe("AudioReviewPlayer edge cases", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
  });

  afterEach(() => vi.restoreAllMocks());

  it("resets time, duration, playback state, and errors when a new source loads", async () => {
    const view = render(<AudioReviewPlayer audioUrl="blob:first" durationSeconds={12} moments={[]} />);
    const audio = document.querySelector("audio")!;
    Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 8 });
    fireEvent(audio, new Event("timeupdate"));
    fireEvent.click(screen.getByRole("button", { name: "Play recording" }));
    expect(await screen.findByRole("button", { name: "Pause recording" })).toBeTruthy();
    fireEvent(audio, new Event("error"));
    expect(await screen.findByRole("alert")).toBeTruthy();

    view.rerender(<AudioReviewPlayer audioUrl="blob:second" durationSeconds={4} moments={[]} />);
    const nextAudio = document.querySelector("audio")!;
    fireEvent(nextAudio, new Event("loadstart"));
    expect(screen.getByText("00:00 / 00:04")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play recording" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("pauses the media element during cleanup", () => {
    const view = render(<AudioReviewPlayer audioUrl="blob:audio" durationSeconds={4} moments={[]} />);
    const audio = document.querySelector("audio")!;
    view.unmount();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(audio).toBeTruthy();
  });

  it("keeps the slider disabled when duration is zero", () => {
    render(<AudioReviewPlayer audioUrl="blob:audio" durationSeconds={0} moments={[]} />);
    expect((screen.getByRole("slider") as HTMLInputElement).disabled).toBe(true);
  });

  it("allows an annotated moment to be selected without audio", () => {
    const onMomentSelect = vi.fn();
    const moment = { at: 2, label: "Review this", observation: "Clear point" };
    render(<AudioReviewPlayer moments={[moment]} onMomentSelect={onMomentSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Review this/ }));
    expect(onMomentSelect).toHaveBeenCalledWith(moment);
  });

  it("uses durationchange metadata when loadedmetadata is not available", () => {
    render(<AudioReviewPlayer audioUrl="blob:audio" durationSeconds={0} moments={[]} />);
    const audio = document.querySelector("audio")!;
    Object.defineProperty(audio, "duration", { configurable: true, value: 9 });
    fireEvent(audio, new Event("durationchange"));
    expect(screen.getByText("00:00 / 00:09")).toBeTruthy();
  });
});
