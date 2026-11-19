import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioReviewPlayer, type ReviewMoment } from "@/components/AudioReviewPlayer";

const moments: ReviewMoment[] = [
  { id: "f1", at: 10, end: 10.3, kind: "filler", label: "Filler “um”" },
  { id: "f2", at: 10.5, end: 10.8, kind: "filler", label: "Filler “uh”" },
  // The word before this pause starts at 39.2 s.
  { id: "p1", at: 40, end: 40.6, kind: "pause", playFrom: 39.2, label: "Pause inside sentence, 0.6 s" },
  { id: "c1", at: 80, end: 82, kind: "strength", label: "Strength", text: "Clear close", observation: "Good", nextStep: "Keep it" },
];

function renderPlayer(props: Partial<Parameters<typeof AudioReviewPlayer>[0]> = {}) {
  const onMomentSelect = vi.fn();
  render(<AudioReviewPlayer audioUrl="blob:audio" durationSeconds={100} moments={moments} onMomentSelect={onMomentSelect} {...props} />);
  const audio = document.querySelector("audio")!;
  Object.defineProperty(audio, "currentTime", { configurable: true, writable: true, value: 0 });
  return { onMomentSelect, audio, markers: within(screen.getByRole("group", { name: "Recording moments" })).queryAllByRole("button") };
}

describe("AudioReviewPlayer timeline markers", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
  });

  it("places markers at their share of the recording and merges close ones", () => {
    const { markers } = renderPlayer();
    expect(markers).toHaveLength(3);
    expect(markers[0].getAttribute("aria-label")).toBe("00:10 · 2 moments: Filler “um”, Filler “uh”");
    expect(markers[1].style.left).toBe("40%");
    expect(markers[2].getAttribute("aria-label")).toBe("01:20 · Strength · Clear close");
  });

  it("plays a pause marker from the word before the pause, so it can be heard, and reports it", () => {
    const { markers, audio, onMomentSelect } = renderPlayer();
    fireEvent.click(markers[1]);
    // The pause runs 40 to 40.6 s. Starting at 40 would begin inside the silence.
    expect(audio.currentTime).toBe(39.2);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(onMomentSelect).toHaveBeenCalledWith(moments[2]);
  });

  it("still plays filler and coaching markers from their own time", () => {
    const { markers, audio } = renderPlayer();
    fireEvent.click(markers[0]);
    expect(audio.currentTime).toBe(10);
    fireEvent.click(markers[2]);
    expect(audio.currentTime).toBe(80);
  });

  it("falls back to a one-second lead-in for a pause with no word before it", () => {
    const bare: ReviewMoment[] = [{ id: "p2", at: 40, end: 40.6, kind: "pause", label: "Pause inside sentence, 0.6 s" }];
    const { markers, audio } = renderPlayer({ moments: bare });
    fireEvent.click(markers[0]);
    expect(audio.currentTime).toBe(39);
  });

  // Regression: moving between moments must seek each time, including back to
  // a pause that was already chosen, and never land inside or after the pause.
  it("seeks to the right place each time when clicking between moments", () => {
    const { markers, audio } = renderPlayer();
    const plays = vi.mocked(HTMLMediaElement.prototype.play);
    for (const [index, expected] of [[1, 39.2], [0, 10], [2, 80], [1, 39.2], [1, 39.2]] as const) {
      audio.currentTime = 55; // wherever playback had got to
      fireEvent.click(markers[index]);
      expect(audio.currentTime).toBe(expected);
    }
    expect(plays).toHaveBeenCalledTimes(5);
  });

  it("never starts a pause before the beginning of the recording", () => {
    const early: ReviewMoment[] = [{ id: "p0", at: 0.6, end: 1.1, kind: "pause", label: "Pause inside sentence, 0.5 s" }];
    const { markers, audio } = renderPlayer({ moments: early });
    audio.currentTime = 30;
    fireEvent.click(markers[0]);
    expect(audio.currentTime).toBe(0);
  });

  it("seeks to a requested time and plays, never before zero", () => {
    const { rerender } = render(<AudioReviewPlayer audioUrl="blob:audio" durationSeconds={100} moments={moments} seekRequest={{ seconds: 13.66 }} />);
    const audio = document.querySelector("audio")!;
    expect(audio.currentTime).toBeCloseTo(13.66);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    // Asking for the same place again seeks and plays again.
    audio.currentTime = 50;
    rerender(<AudioReviewPlayer audioUrl="blob:audio" durationSeconds={100} moments={moments} seekRequest={{ seconds: 13.66 }} />);
    expect(audio.currentTime).toBeCloseTo(13.66);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    rerender(<AudioReviewPlayer audioUrl="blob:audio" durationSeconds={100} moments={moments} seekRequest={{ seconds: -2 }} />);
    expect(audio.currentTime).toBe(0);
  });

  it("shows a legend for the marker kinds present", () => {
    renderPlayer();
    const legend = screen.getByRole("list", { name: "Marker legend" });
    expect(within(legend).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Filler word", "Pause inside a sentence", "Coaching moment"]);
  });

  it("steps to the next and previous moment from the current time", () => {
    const { audio, onMomentSelect } = renderPlayer();
    expect((screen.getByRole("button", { name: "Previous moment" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next moment" }));
    expect(audio.currentTime).toBe(10);
    fireEvent(audio, new Event("timeupdate"));
    fireEvent.click(screen.getByRole("button", { name: "Next moment" }));
    expect(audio.currentTime).toBe(39.2);
    expect(onMomentSelect).toHaveBeenLastCalledWith(moments[2]);
    fireEvent(audio, new Event("timeupdate"));
    fireEvent.click(screen.getByRole("button", { name: "Previous moment" }));
    expect(onMomentSelect).toHaveBeenLastCalledWith(moments[1]);
  });

  it("moves on from a pause while its lead-in is still playing", () => {
    const { audio, markers, onMomentSelect } = renderPlayer();
    fireEvent.click(markers[1]);
    // The playhead is at 39.2 s, ahead of the pause at 40 s that was just chosen.
    fireEvent(audio, new Event("timeupdate"));
    fireEvent.click(screen.getByRole("button", { name: "Next moment" }));
    expect(onMomentSelect).toHaveBeenLastCalledWith(moments[3]);
    expect(audio.currentTime).toBe(80);
  });

  it("rings the marker at the current time", () => {
    const { audio, markers } = renderPlayer();
    audio.currentTime = 40.2;
    fireEvent(audio, new Event("timeupdate"));
    expect(markers[1].querySelector(".marker-bar")?.getAttribute("data-now")).toBe("true");
    expect(markers[1].querySelector(".marker-bar")?.className).toContain("ring-cream");
    expect(markers[0].querySelector(".marker-bar")?.getAttribute("data-now")).toBe("false");
  });

  it("shows no legend or step buttons when there are no moments", () => {
    renderPlayer({ moments: [] });
    expect(screen.queryByRole("list", { name: "Marker legend" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next moment" })).toBeNull();
  });

  it("switches playback off when the audio file can't be loaded", () => {
    const onLoadError = vi.fn();
    const { audio, markers } = renderPlayer({ onLoadError });
    fireEvent(audio, new Event("error"));
    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toBe("This recording could not be loaded.");
    expect((screen.getByRole("button", { name: "Play recording" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("slider", { name: "Recording position" }) as HTMLInputElement).disabled).toBe(true);
    expect((markers[0] as HTMLButtonElement).disabled).toBe(true);
    expect((markers[2] as HTMLButtonElement).disabled).toBe(false);
  });

  it("reports blocked playback from a marker click", async () => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockRejectedValue(new Error("blocked")) });
    const { markers } = renderPlayer();
    fireEvent.click(markers[1]);
    expect((await screen.findByRole("alert")).textContent).toContain("Playback was blocked");
  });
});
