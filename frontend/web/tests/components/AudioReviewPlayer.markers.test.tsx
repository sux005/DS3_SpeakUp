import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioReviewPlayer, type ReviewMoment } from "@/components/AudioReviewPlayer";

const moments: ReviewMoment[] = [
  { id: "f1", at: 10, end: 10.3, kind: "filler", label: "Filler “um”" },
  { id: "f2", at: 10.5, end: 10.8, kind: "filler", label: "Filler “uh”" },
  { id: "p1", at: 40, end: 40.6, kind: "pause", label: "Pause inside sentence, 0.6 s" },
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

  it("seeks to and plays from a clicked marker, and reports it", () => {
    const { markers, audio, onMomentSelect } = renderPlayer();
    fireEvent.click(markers[1]);
    expect(audio.currentTime).toBe(40);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(onMomentSelect).toHaveBeenCalledWith(moments[2]);
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
    expect(audio.currentTime).toBe(40);
    fireEvent(audio, new Event("timeupdate"));
    fireEvent.click(screen.getByRole("button", { name: "Previous moment" }));
    expect(onMomentSelect).toHaveBeenLastCalledWith(moments[1]);
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

  it("reports blocked playback from a marker click", async () => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockRejectedValue(new Error("blocked")) });
    const { markers } = renderPlayer();
    fireEvent.click(markers[1]);
    expect((await screen.findByRole("alert")).textContent).toContain("Playback was blocked");
  });
});
