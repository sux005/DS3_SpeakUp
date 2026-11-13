import { expect, test, type Page } from "@playwright/test";

const storageKey = "speakup-frontend-demo-v1";
const projectId = "coverage-project";
const completeId = "complete-no-review";
const processingId = "coverage-processing";
const failedId = "coverage-failed";

type Status = "COMPLETE" | "PROCESSING" | "FAILED" | "PURGE_PENDING";

function recording(recordingId: string, status: Status, createdAt: string, extra: Record<string, unknown> = {}) {
  return { project_id: projectId, recording_id: recordingId, status, created_at: createdAt, ...extra };
}

function baseState(recordings: unknown[], reviews: Record<string, unknown> = {}) {
  return {
    projects: [{ project_id: projectId, project_title: "Coverage project", description: "Test project", created_at: "2026-11-01T00:00:00.000Z" }],
    recordings,
    reviews,
  };
}

async function setState(page: Page, state: unknown) {
  await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: state });
}

async function cleanHome(page: Page) {
  await page.addInitScript((key) => window.localStorage.removeItem(key), storageKey);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Practice your next presentation" })).toBeVisible();
}

async function uploadHome(page: Page, title?: string) {
  await page.getByRole("button", { name: "+ New presentation" }).click();
  if (title) await page.getByPlaceholder("We’ll use today’s date if you skip this").fill(title);
  await page.locator('input[type="file"]').setInputFiles({
    name: "browser-take.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFF----WAVEfmt "),
  });
  await page.getByRole("button", { name: "Start presentation with audio" }).click();
}

test.describe("home and project route states", () => {
  test("persists a custom home title and uses a date fallback when omitted", async ({ page }) => {
    await page.goto("/");
    await page.evaluate((key) => window.localStorage.removeItem(key), storageKey);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Practice your next presentation" })).toBeVisible();
    await uploadHome(page, "Custom rehearsal");
    await expect(page).toHaveURL(/\/recordings\/[^/]+\/analyzing$/);
    await page.getByRole("link", { name: "Return to project" }).click();
    await expect(page.getByRole("heading", { name: "Custom rehearsal" })).toBeVisible();
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Custom rehearsal" })).toBeVisible();

    await page.getByRole("button", { name: "+ New presentation" }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "fallback.wav", mimeType: "audio/wav", buffer: Buffer.from("RIFF") });
    await page.getByRole("button", { name: "Start presentation with audio" }).click();
    await page.getByRole("link", { name: "Return to project" }).click();
    await expect(page.getByRole("heading", { name: /^Presentation [A-Z][a-z]{2} \d{1,2}$/ })).toBeVisible();
  });

  test("renders project ordering, chart data, status actions, and failed reason", async ({ page }) => {
    const metrics = { duration_seconds: 30, words_per_minute: 140, fillers_per_100_words: 1, pauses_per_speaking_minute: 4, rubric_scores: { speaking_rate: 4, filler_words: 4, pauses_inside_sentences: 4 } };
    await setState(page, baseState([
      recording("old-complete", "COMPLETE", "2026-11-01T01:00:00.000Z", { summary_metrics: metrics }),
      recording(processingId, "PROCESSING", "2026-11-01T02:00:00.000Z"),
      recording(failedId, "FAILED", "2026-11-01T03:00:00.000Z", { failure_reason: "Fixture processing error" }),
      recording("new-complete", "COMPLETE", "2026-11-01T04:00:00.000Z"),
    ]));
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByRole("heading", { name: "Coverage project" })).toBeVisible();
    await expect(page.getByText("Your practice, over time.")).toBeVisible();
    await expect(page.getByText("Fixture processing error")).toBeVisible();
    await expect(page.getByRole("link", { name: "Review →" })).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Status →" })).toHaveCount(1);
    const takes = page.locator("li").filter({ hasText: /Take 0[1-4]/ });
    await expect(takes.first()).toContainText("Take 04");
    await expect(takes.last()).toContainText("Take 01");
  });

  test("handles a missing new-attempt project", async ({ page }) => {
    await cleanHome(page);
    await page.goto("/projects/missing-project/new");
    await expect(page.getByText("Presentation not found.")).toBeVisible();
    await expect(page.getByRole("link", { name: "All presentations" })).toHaveAttribute("href", "/");
  });
});

test.describe("analyzing and results route states", () => {
  test("selects a listening goal and shows a completed recording without analysis", async ({ page }) => {
    await setState(page, baseState([recording(completeId, "COMPLETE", "2026-11-02T00:00:00.000Z")]));
    await page.goto(`/recordings/${completeId}/analyzing`);
    await expect(page.getByRole("heading", { name: "Demo processing complete" })).toBeVisible();
    await expect(page.getByText("This demo recording has no transcript or scores.")).toBeVisible();
    await page.getByRole("button", { name: "Clarity" }).click();
    await expect(page.getByText("Which sentence made your main point easiest to understand?")).toBeVisible();
    await page.getByRole("link", { name: "See results →" }).click();
    await expect(page.getByRole("heading", { name: "Your demo recording" })).toBeVisible();
    await expect(page.getByText("Analysis is not connected")).toBeVisible();
  });

  test("treats purge-pending recordings as unavailable", async ({ page }) => {
    await setState(page, baseState([recording("purged", "PURGE_PENDING", "2026-11-02T00:00:00.000Z")]));
    await page.goto("/recordings/purged/analyzing");
    await expect(page.getByRole("heading", { name: "Recording unavailable" })).toBeVisible();
    await expect(page.getByText("This recording is unavailable.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Analysis stages" })).toHaveCount(0);
  });

  test("opens feedback moments and displays their next step", async ({ page }) => {
    const metrics = { duration_seconds: 12, words_per_minute: 130, fillers_per_100_words: 2, pauses_per_speaking_minute: 5, rubric_scores: { speaking_rate: 3, filler_words: 3, pauses_inside_sentences: 3 }, filler_occurrences: [], pauses: [], long_pauses: [] };
    const review = {
      recording_id: "review-with-moment",
      transcript: { text: "Hello world.", items: [{ type: "pronunciation", start_time: "0", end_time: "1", alternatives: [{ content: "Hello" }] }, { type: "punctuation", alternatives: [{ content: "." }] }] },
      analysis: metrics,
      feedback: { feedback: "Keep going.", moments: [{ id: "moment-1", start_seconds: 0, end_seconds: 1, text: "Opening", kind: "strength", observation: "Clear start", next_step: "Keep this energy." }] },
    };
    await setState(page, baseState([recording("review-with-moment", "COMPLETE", "2026-11-02T00:00:00.000Z")], { "review-with-moment": review }));
    await page.goto("/recordings/review-with-moment");
    await expect(page.getByRole("heading", { name: "Your results" })).toBeVisible();
    await page.getByRole("button", { name: /^00:00 · Strength/ }).click();
    const listen = page.getByRole("region", { name: "Listen back" });
    await expect(listen.getByText("Clear start")).toBeVisible();
    await expect(listen.getByText("Keep this energy.")).toBeVisible();
  });
});

test.describe("responsive route smoke", () => {
  test("keeps the home controls usable on a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await cleanHome(page);
    await expect(page.getByRole("switch", { name: "Dark mode" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New presentation" })).toBeVisible();
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(horizontalOverflow).toBe(false);
  });

  test("respects reduced motion and keeps controls keyboard reachable", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setState(page, baseState([recording(processingId, "PROCESSING", "2026-11-02T00:00:00.000Z")]));
    await page.goto(`/recordings/${processingId}/analyzing`);
    await expect(page.locator(".analyzing-dots")).toBeVisible();
    const dotsAnimation = await page.locator(".analyzing-dots span").first().evaluate((element) => getComputedStyle(element).animationName);
    const pipAnimation = await page.locator(".pip-motion").evaluate((element) => getComputedStyle(element).animationName);
    expect(dotsAnimation).toBe("none");
    expect(pipAnimation).toBe("none");

    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "SpeakUp" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "MY PRESENTATIONS" })).toBeFocused();
  });
});
