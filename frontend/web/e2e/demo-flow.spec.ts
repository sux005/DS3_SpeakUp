import { expect, test, type Page } from "@playwright/test";

const projectId = "project-demo-day";
const completeRecordingId = "8f2d9305-51f8-5ea1-9dbf-d5fc94b87f08";
const processingRecordingId = "ec4bb4c2-f423-5f06-86b7-5ee814c4b598";
const failedRecordingId = "63c7255c-c5fd-5d77-86c2-b9ad4ec15498";
const storageKey = "speakup-frontend-demo-v1";

async function startWithCleanDemo(page: Page) {
  await page.addInitScript((key) => window.localStorage.removeItem(key), storageKey);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Practice your next presentation" })).toBeVisible();
}

function demoState(recordingId: string, status: "PROCESSING" | "COMPLETE" | "FAILED" | "DELETED", startedAt?: number) {
  return {
    projects: [{ project_id: projectId, project_title: "Test presentation", description: "", created_at: "2026-11-04T17:00:00.000Z" }],
    recordings: [{ project_id: projectId, recording_id: recordingId, created_at: "2026-11-04T18:00:00.000Z", status, ...(startedAt ? { demo_started_at: startedAt } : {}), ...(status === "FAILED" ? { failure_reason: "Fixture failure" } : {}) }],
    reviews: {},
  };
}

test.describe("fixture-backed presentation navigation", () => {
  test("pauses and resumes a microphone take before preview", async ({ page }) => {
    await page.addInitScript(() => {
      class TestRecorder {
        static isTypeSupported() { return true; }
        state: RecordingState = "inactive";
        mimeType = "audio/webm";
        ondataavailable: ((event: BlobEvent) => void) | null = null;
        onstop: (() => void) | null = null;
        start() { this.state = "recording"; }
        pause() { this.state = "paused"; }
        resume() { this.state = "recording"; }
        stop() {
          this.state = "inactive";
          this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) } as BlobEvent);
          this.onstop?.();
        }
      }
      Object.defineProperty(window, "MediaRecorder", { configurable: true, value: TestRecorder });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
      });
      Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
      Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
    });
    await startWithCleanDemo(page);
    await page.getByRole("link", { name: "Open presentation" }).click();
    await page.getByRole("link", { name: "+ New attempt" }).click();
    await page.getByRole("button", { name: "● Record audio" }).click();
    await expect(page.getByText("Recording starts in 3…")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ⅱ Pause recording" })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Ⅱ Pause recording" }).click();
    await expect(page.getByText(/^PAUSED \d\d:\d\d \/ 10:00$/)).toBeVisible();
    await page.getByRole("button", { name: "▶ Resume recording" }).click();
    await expect(page.getByText("Recording resumes in 3…")).toBeVisible();
    await expect(page.getByText("Recording resumes in 1…")).toBeVisible();
    await expect(page.getByText(/^RECORDING \d\d:\d\d \/ 10:00$/)).toBeVisible();
    await page.getByRole("button", { name: "■ Stop recording" }).click();
    await expect(page.getByLabel("Preview selected audio")).toBeVisible();
  });

  test("opens a seeded presentation and its new-attempt flow", async ({ page }) => {
    await startWithCleanDemo(page);
    await page.getByRole("link", { name: "Open presentation" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
    await expect(page.getByRole("heading", { name: "project larp" })).toBeVisible();
    await expect(page.getByText(/3 attempts · Created/)).toBeVisible();

    await page.getByRole("link", { name: "+ New attempt" }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/new$`));
    await expect(page.getByRole("heading", { name: "Record or upload" })).toBeVisible();
    await expect(page.getByText("WAV, MP3, M4A or WebM, up to 100 MB.")).toBeVisible();
    await expect(page.getByText("Uses your microphone. Recording stops after 10 minutes.")).toHaveCount(0);
  });

  test("uploads a local audio file and enters analyzing without an API", async ({ page }) => {
    await startWithCleanDemo(page);
    await page.getByRole("button", { name: "+ New presentation" }).click();
    await page.getByPlaceholder("We’ll use today’s date if you skip this").fill("Browser upload test");

    await page.locator('input[type="file"]').setInputFiles({
      name: "practice.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from("RIFF----WAVEfmt "),
    });
    await expect(page.getByText("READY · practice.wav")).toBeVisible();
    await page.getByRole("button", { name: "Start presentation with audio" }).click();

    await expect(page).toHaveURL(/\/recordings\/[^/]+\/analyzing$/);
    await expect(page.getByRole("heading", { name: /Analyzing/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Analysis stages" })).toBeVisible();
  });

  test("rejects unsupported uploads before creating a presentation", async ({ page }) => {
    await startWithCleanDemo(page);
    await page.getByRole("button", { name: "+ New presentation" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not audio"),
    });
    await expect(page.locator('section[aria-label="Demo recording upload"] [role="alert"]')).toHaveText("Choose a WAV, MP3, M4A, or WebM audio file.");
    await expect(page.getByRole("button", { name: "Start presentation with audio" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
  });

  test("discards a selected file before submission", async ({ page }) => {
    await startWithCleanDemo(page);
    await page.getByRole("button", { name: "+ New presentation" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "take.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from("RIFF----WAVEfmt "),
    });
    await expect(page.getByText("READY · take.wav")).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByText("DEMO ONLY · Nothing is sent to AWS")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start presentation with audio" })).toHaveCount(0);
  });
});

test.describe("analysis and review states", () => {
  test("shows a processing stage and advances the local demo state", async ({ page }) => {
    const state = demoState(processingRecordingId, "PROCESSING", Date.now());
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: state });
    await page.goto(`/recordings/${processingRecordingId}/analyzing`);
    await expect(page.getByText("Simulating timestamp alignment…")).toBeVisible();
    await expect(page.locator(".analyzing-dots")).toBeVisible();

    await page.waitForTimeout(3_400);
    await expect(page.getByText("Simulating measurements…")).toBeVisible();
    await expect(page.getByText("Demo transcript stage finished.")).toBeVisible();
  });

  test("renders the seeded completed review with metrics and coaching", async ({ page }) => {
    await startWithCleanDemo(page);
    await page.goto(`/recordings/${completeRecordingId}`);
    await expect(page.getByRole("heading", { name: "Your results" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Your scores" }).getByText("134.08", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your takeaway" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Moments to replay" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your next practice step" })).toBeVisible();
    // The seeded clip has no coaching, and the page says so rather than inventing any.
    await expect(page.getByRole("region", { name: "Your takeaway" }).getByRole("status")).toContainText("Coaching isn't available for this recording.");
  });

  test("guards a review that is still processing", async ({ page }) => {
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)), {
      key: storageKey,
      value: demoState(processingRecordingId, "PROCESSING", Date.now()),
    });
    await page.goto(`/recordings/${processingRecordingId}`);
    await expect(page.getByText("This recording is not ready yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "View status" })).toHaveAttribute("href", `/recordings/${processingRecordingId}/analyzing`);
  });
});

test.describe("theme and exception states", () => {
  test("persists dark mode across a reload", async ({ page }) => {
    await startWithCleanDemo(page);
    const toggle = page.getByRole("switch", { name: "Dark mode" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("switch", { name: "Dark mode" })).toHaveAttribute("aria-checked", "true");
  });

  test("shows failed analysis with its failure reason", async ({ page }) => {
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)), {
      key: storageKey,
      value: demoState(failedRecordingId, "FAILED"),
    });
    await page.goto(`/recordings/${failedRecordingId}/analyzing`);
    await expect(page.getByRole("heading", { name: "Analysis failed" })).toBeVisible();
    await expect(page.getByText("Fixture failure")).toBeVisible();
    await expect(page.getByRole("link", { name: "Return to project" })).toBeVisible();
  });

  test("shows unavailable state for a deleted recording", async ({ page }) => {
    const state = demoState(failedRecordingId, "DELETED");
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: state });
    await page.goto(`/recordings/${failedRecordingId}/analyzing`);
    await expect(page.getByRole("heading", { name: "Recording unavailable" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Analysis stages" })).toHaveCount(0);
  });

  test("handles unknown recording and presentation routes", async ({ page }) => {
    await startWithCleanDemo(page);
    await page.goto("/recordings/does-not-exist/analyzing");
    await expect(page.getByText("Recording not found.")).toBeVisible();
    await page.goto("/projects/does-not-exist");
    await expect(page.getByText("Presentation not found.")).toBeVisible();
    await expect(page.getByRole("link", { name: "All presentations" })).toBeVisible();
  });
});
