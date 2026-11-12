import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptPlayer } from "@/components/TranscriptPlayer";
import { RubricScore } from "@/components/RubricScore";
import RubricPage from "@/app/rubric/page";
import LoginPage from "@/app/login/page";
import { AudioReviewPlayer } from "@/components/AudioReviewPlayer";
vi.mock("next/form", () => ({ default: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));
beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: vi.fn() });
});
describe("preserved MVP features", () => {
  it("keeps rubric bands and demo sign-in accessible", () => {
    render(<RubricPage />);
    expect(screen.getByRole("heading", { name: "The Rubric" })).toBeTruthy();
    expect(screen.getAllByRole("table")).toHaveLength(3);
    render(<LoginPage />);
    expect(screen.getByText("DEMO: NOT CONNECTED TO COGNITO YET")).toBeTruthy();
    render(<><RubricScore score={null} /><RubricScore score={3} /></>);
    expect(screen.getByText(/Not scored/)).toBeTruthy();
  });
  it("seeks from transcript words, filters fillers/pauses, and reports missing demo audio", () => {
    render(<TranscriptPlayer audioSrc="/demo/sample-take.mp3" coaching={<p>Practice</p>} moments={[{ at: 2, label: "filler" }, { at: 3, label: "pause" }]} sentences={[
      { id: 0, start: 2, end: 2.5, text: "Um,", words: [{ start: 2, end: 2.5, text: "Um,", filler: true }], tag: "FILLER" },
      { id: 1, start: 3, end: 4, text: "Hello.", words: [{ start: 3, end: 4, text: "Hello.", filler: false }], tag: "PAUSE" },
    ]} />);
    const audio = document.querySelector("audio")!;
    fireEvent.click(screen.getByRole("button", { name: "Um," }));
    expect(audio.currentTime).toBe(1.5);
    fireEvent.click(screen.getByRole("button", { name: "FILLERS (1)" }));
    expect(screen.queryByRole("button", { name: "Hello." })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "PAUSES" }));
    expect(screen.getByRole("button", { name: "Hello." })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /00:03 · pause/ }));
    expect(audio.currentTime).toBe(2.5);
    fireEvent.click(screen.getByRole("button", { name: /00:03 · PAUSE/ }));
    fireEvent.click(screen.getByRole("button", { name: "ALL" }));
    audio.currentTime = 3.2;
    fireEvent.timeUpdate(audio);
    fireEvent.error(audio);
    expect(screen.getByText(/No audio file found/)).toBeTruthy();
  });
  it("replays a clicked transcript position even when it repeats", async () => {
    const onTimeChange = vi.fn();
    const { rerender } = render(<AudioReviewPlayer audioUrl="blob:test" moments={[]} onTimeChange={onTimeChange} />);
    rerender(<AudioReviewPlayer audioUrl="blob:test" moments={[]} onTimeChange={onTimeChange} seekRequest={{ seconds: 2 }} />);
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(document.querySelector("audio")!.currentTime).toBe(2);
    rerender(<AudioReviewPlayer audioUrl="blob:test" moments={[]} onTimeChange={onTimeChange} seekRequest={{ seconds: 2 }} />);
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2));
  });
});
