import { expect, test, type Page, type Route } from "@playwright/test";

const storageOrigin = "http://storage.example.test";
const projectId = "live-project";
const recordingId = "live-recording";

type RecordingStatus = "UPLOADED" | "PROCESSING" | "COMPLETE" | "FAILED";

const project = {
  project_id: projectId,
  project_title: "Live rehearsal",
  description: "",
  created_at: "2026-11-12T16:00:00.000Z",
};

const metrics = {
  duration_seconds: 42,
  words_per_minute: 128,
  fillers_per_100_words: 2,
  pauses_per_speaking_minute: 3,
  rubric_scores: { speaking_rate: 4, filler_words: 3, pauses_inside_sentences: 4 },
  filler_occurrences: [],
  pauses: [],
  long_pauses: [],
};

const structuredFeedback = {
  feedback: "Lead with your clearest point.",
  schema_version: 2,
  categories: {
    general: { observation: "Your opening is clear.", next_step: "State the main point first." },
    pace: { observation: "128 WPM.", next_step: "Keep a steady pace." },
  },
  moments: [{ id: "s1", start_seconds: 0, end_seconds: 1, text: "Today", kind: "strength", observation: "The opening lands clearly.", next_step: "Keep this opening." }],
};

function recording(status: RecordingStatus, failure_reason?: string) {
  return {
    project_id: projectId,
    recording_id: recordingId,
    created_at: "2026-11-12T16:01:00.000Z",
    status,
    ...(failure_reason ? { failure_reason } : {}),
  };
}

function review(feedback: unknown = {
  feedback: "Lead with your clearest point.",
  moments: [],
}) {
  return {
    recording_id: recordingId,
    transcript: {
      text: "Today we ship the update.",
      items: [
        ...["Today", "we", "ship", "the", "update"].map((content, index) => ({
          type: "pronunciation", start_time: String(index), end_time: String(index + 1),
          alternatives: [{ content }],
        })),
        { type: "punctuation", alternatives: [{ content: "." }] },
      ],
    },
    summary_metrics: metrics,
    feedback,
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installLiveApi(page: Page, options: {
  statuses: RecordingStatus[];
  feedback?: unknown;
  reviewUnavailable?: boolean;
  reviewFailures?: number;
  rateLimitProjects?: boolean;
  seedRecording?: boolean;
}): Promise<{ put: Promise<boolean>; setStatus: (status: RecordingStatus) => void }> {
  let statusIndex = 0;
  let reviewFailures = options.reviewFailures ?? 0;
  let overrideStatus: RecordingStatus | null = null;
  let projectCreated = Boolean(options.seedRecording);
  let uploadReserved = Boolean(options.seedRecording);
  let putSeen = false;
  const put = new Promise<boolean>((resolve) => {
    void page.route(`${storageOrigin}/**`, async (route) => {
      if (route.request().method() === "PUT") {
        putSeen = true;
        await route.fulfill({ status: 200, body: "" });
        resolve(putSeen);
      } else {
        await route.continue();
      }
    });
    void page.route("**/api/speakup/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api\/speakup/, "");

      if (path === "/session") {
        await json(route, { guest: true });
        return;
      }
      if (path === "/projects" && request.method() === "GET") {
        if (options.rateLimitProjects) {
          await json(route, { code: "RATE_LIMITED", message: "Too many requests" }, 429);
        } else {
          await json(route, { items: projectCreated ? [project] : [] });
        }
        return;
      }
      if (path === "/account/limits") {
        await json(route, { max_audio_upload_bytes: 1_000_000, max_audio_duration_seconds: 60 });
        return;
      }
      if (path === `/projects/${projectId}/recordings`) {
        await json(route, { items: projectCreated && uploadReserved ? [recording(options.statuses[0])] : [] });
        return;
      }
      if (path === "/projects" && request.method() === "POST") {
        projectCreated = true;
        await json(route, project);
        return;
      }
      if (path === "/uploads" && request.method() === "POST") {
        uploadReserved = true;
        await json(route, {
          recording: recording("UPLOADED"),
          recording_id: recordingId,
          upload_url: `${storageOrigin}/uploads/reserved-audio.wav`,
          expires_at: "2026-11-12T17:00:00.000Z",
          required_headers: { "Content-Type": "audio/wav" },
          expected_content_length: 16,
          max_content_length: 1_000_000,
        });
        return;
      }
      if (path === `/recordings/${recordingId}`) {
        const current = overrideStatus ?? options.statuses[Math.min(statusIndex++, options.statuses.length - 1)];
        await json(route, recording(current, current === "FAILED" ? "Transcription failed" : undefined));
        return;
      }
      if (path === `/recordings/${recordingId}/review`) {
        if (reviewFailures > 0) {
          reviewFailures -= 1;
          await json(route, { message: "Review temporarily unavailable" }, 503);
          return;
        }
        await json(route, options.reviewUnavailable ? { message: "Resource not found" } : review(options.feedback), options.reviewUnavailable ? 404 : 200);
        return;
      }
      if (path === `/recordings/${recordingId}/artifacts/transcript`) {
        await json(route, { recording_id: recordingId, artifact_type: "transcript", data: review().transcript });
        return;
      }
      if (path === `/recordings/${recordingId}/artifacts/analysis`) {
        await json(route, { recording_id: recordingId, artifact_type: "analysis", data: { metrics } });
        return;
      }
      if (path === `/recordings/${recordingId}/artifacts/feedback`) {
        await json(route, { recording_id: recordingId, artifact_type: "feedback", data: options.feedback });
        return;
      }
      if (path === `/recordings/${recordingId}/download`) {
        await json(route, { download_url: `${storageOrigin}/audio/live.wav` });
        return;
      }
      await route.continue();
    });
  });
  return { put, setStatus: (status) => { overrideStatus = status; } };
}

async function uploadFromHome(page: Page, title = "Live rehearsal") {
  await page.getByRole("button", { name: "+ New presentation" }).click();
  await page.getByPlaceholder("We’ll use today’s date if you skip this").fill(title);
  await page.locator('input[type="file"]').setInputFiles({
    name: "live-take.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF----WAVEfmt "),
  });
  await page.getByRole("button", { name: "Start presentation with audio" }).click();
}

test("creates a project, uploads to the signed URL, and reaches a completed review", async ({ page }) => {
  const { put } = await installLiveApi(page, { statuses: ["UPLOADED", "PROCESSING", "COMPLETE"] });
  await page.goto("/");
  await expect(page.getByText("LIVE SYNC")).toBeVisible();
  await uploadFromHome(page);
  await expect(put).resolves.toBe(true);
  await expect(page).toHaveURL(`/recordings/${recordingId}/analyzing`);
  await expect(page.getByRole("heading", { name: "Analysis ready" })).toBeVisible();
  await page.getByRole("link", { name: "See results →" }).click();
  await expect(page.getByRole("heading", { name: "Your results" })).toBeVisible();
  await expect(page.getByText("128 WPM")).toBeVisible();
  await expect(page.getByText("Lead with your clearest point.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("button", { name: "update." })).toBeVisible();
});

test("renders a completed review when feedback is nullable", async ({ page }) => {
  await installLiveApi(page, { statuses: ["COMPLETE"], feedback: null, seedRecording: true });
  await page.goto(`/recordings/${recordingId}`);
  await expect(page.getByRole("heading", { name: "Your results" })).toBeVisible();
  await expect(page.getByText("128 WPM")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Coaching isn't available for this recording." })).toBeVisible();
});

test("renders Bedrock coaching from artifacts when the deployed API has no review route", async ({ page }) => {
  await installLiveApi(page, { statuses: ["COMPLETE"], reviewUnavailable: true, feedback: structuredFeedback, seedRecording: true });
  await page.goto(`/recordings/${recordingId}`);
  await expect(page.getByRole("heading", { name: "Your results" })).toBeVisible();
  await expect(page.getByText("Lead with your clearest point.")).toBeVisible();
  await expect(page.getByText("The opening lands clearly.").first()).toBeVisible();
  await expect(page.getByText("State the main point first.")).toBeVisible();
  await expect(page.getByRole("button", { name: "update." })).toBeVisible();
});

test("retries a temporary review failure after processing completes", async ({ page }) => {
  await installLiveApi(page, { statuses: ["COMPLETE"], reviewFailures: 1, feedback: structuredFeedback, seedRecording: true });
  await page.goto(`/recordings/${recordingId}`);
  await expect(page.getByRole("heading", { name: "Review could not load" })).toBeVisible();
  await page.getByRole("button", { name: "Retry loading review" }).click();
  await expect(page.getByText("The opening lands clearly.").first()).toBeVisible();
});

test("resumes processing after reload and shows the completed recording", async ({ page }) => {
  const { setStatus } = await installLiveApi(page, { statuses: ["PROCESSING"], seedRecording: true });
  await page.goto(`/recordings/${recordingId}/analyzing`);
  await expect(page.getByRole("heading", { name: /Analyzing/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Analyzing/ })).toBeVisible();
  setStatus("COMPLETE");
  await expect(page.getByRole("heading", { name: "Analysis ready" })).toBeVisible({ timeout: 5_000 });
});

test("shows the backend failure state when processing fails", async ({ page }) => {
  await installLiveApi(page, { statuses: ["FAILED"], seedRecording: true });
  await page.goto(`/recordings/${recordingId}/analyzing`);
  await expect(page.getByRole("heading", { name: "Analysis failed" })).toBeVisible();
  await expect(page.getByText("Transcription failed")).toBeVisible();
});

test("shows a rate-limit error when the projects API returns 429", async ({ page }) => {
  await installLiveApi(page, { statuses: ["PROCESSING"], rateLimitProjects: true });
  await page.goto("/");
  await expect(page.getByRole("alert").filter({ hasText: "Too many requests" })).toHaveText("Too many requests");
  await expect(page.getByText("No presentations yet.")).toBeVisible();
});
