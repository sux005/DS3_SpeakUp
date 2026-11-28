import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRACTICE_PROMPTS } from "@/lib/practice-prompts";

const harness = vi.hoisted(() => ({
  router: { push: vi.fn() },
  recorder: { props: null as null | { maxAudioDurationSeconds: number; allowUpload?: boolean; onStatusChange?: (status: string) => void } },
  auth: {
    configured: false,
    user: null as null | { sub: string; email: string },
    openSignIn: vi.fn(),
  },
  store: {
    ready: true,
    live: false,
    error: null as string | null,
    limits: { max_audio_upload_bytes: 104_857_600, max_audio_duration_seconds: 600 },
    createProject: vi.fn(async () => "practice-project"),
    createRecording: vi.fn(async () => "practice-recording"),
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => harness.router }));
vi.mock("@/components/PageHeading", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  PageHeading: ({ title, subtitle }: { title: React.ReactNode; subtitle: string }) => <header><h1>{title}</h1><p>{subtitle}</p></header>,
}));
vi.mock("@/components/MascotState", () => ({ MascotState: ({ message }: { message: string }) => <p>{message}</p> }));
vi.mock("@/components/RecorderUploader", () => ({
  RecorderUploader: (props: { submitLabel: string; maxAudioDurationSeconds: number; allowUpload?: boolean; onStatusChange?: (status: string) => void; onSubmit: (blob: Blob, name: string) => Promise<void> }) => {
    harness.recorder.props = props;
    return <button type="button" onClick={() => void props.onSubmit(new Blob(["audio"], { type: "audio/webm" }), "take.webm")}>{props.submitLabel}</button>;
  },
}));
vi.mock("@/lib/live-store", () => ({ useAppStore: () => harness.store }));
vi.mock("@/lib/auth", () => ({ useAuth: () => harness.auth }));

import PracticePage from "@/app/practice/page";

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  harness.router.push.mockReset();
  harness.store.ready = true;
  harness.store.error = null;
  harness.store.createProject.mockClear();
  harness.store.createRecording.mockClear();
  harness.auth.configured = false;
  harness.auth.user = null;
  harness.auth.openSignIn.mockReset();
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => cleanup());

describe("2-minute practice page", () => {
  it("shows a topic with points and a record-only, 2-minute recorder", async () => {
    render(<PracticePage />);
    await settle();
    const first = PRACTICE_PROMPTS[0];
    expect(screen.getByRole("heading", { name: "2-minute practice speech" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: first.title })).toBeTruthy();
    for (const point of first.points) expect(screen.getByText(point)).toBeTruthy();
    expect(harness.recorder.props?.maxAudioDurationSeconds).toBe(120);
    expect(harness.recorder.props?.allowUpload).toBe(false);
  });

  it("swaps topics, but not while recording", async () => {
    render(<PracticePage />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Another topic" }));
    expect(screen.getByRole("heading", { name: PRACTICE_PROMPTS[1].title })).toBeTruthy();
    act(() => harness.recorder.props?.onStatusChange?.("recording"));
    expect((screen.getByRole("button", { name: "Another topic" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves the take as a warm-up presentation and opens its status", async () => {
    render(<PracticePage />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Score my practice speech" }));
    await waitFor(() => expect(harness.router.push).toHaveBeenCalledWith("/recordings/practice-recording/analyzing"));
    expect(harness.store.createProject).toHaveBeenCalledWith(`Warm-up: ${PRACTICE_PROMPTS[0].title}`, expect.stringContaining(PRACTICE_PROMPTS[0].intro));
    expect(harness.store.createRecording).toHaveBeenCalledWith("practice-project", expect.any(Blob), "take.webm");
  });

  it("asks a signed-out visitor to sign in, then saves the take they recorded", async () => {
    harness.auth.configured = true;
    render(<PracticePage />);
    await settle();
    expect(screen.getByText(/sign in before your score is saved/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Score my practice speech" }));
    expect(harness.auth.openSignIn).toHaveBeenCalledWith(expect.any(Function));
    expect(harness.store.createProject).not.toHaveBeenCalled();
    act(() => harness.auth.openSignIn.mock.calls[0][0]());
    await waitFor(() => expect(harness.router.push).toHaveBeenCalledWith("/recordings/practice-recording/analyzing"));
  });

  it("does not ask signed-in people to sign in, and shows save errors", async () => {
    harness.auth.configured = true;
    harness.auth.user = { sub: "u1", email: "a@b.co" };
    harness.store.error = "Upload failed.";
    render(<PracticePage />);
    await settle();
    expect(screen.queryByText(/sign in before your score is saved/)).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Upload failed.");
  });

  it("waits for the store to load", () => {
    harness.store.ready = false;
    render(<PracticePage />);
    expect(screen.getByText("Getting your practice ready…")).toBeTruthy();
  });
});
