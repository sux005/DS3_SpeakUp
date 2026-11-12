import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DemoProvider, useDemoStore } from "@/lib/demo-store";

const storageKey = "speakup-frontend-demo-v1";

function savedState() {
  return {
    projects: [{ project_id: "saved-project", project_title: "Saved", description: "", created_at: "2025-01-01T00:00:00Z" }],
    recordings: [{ project_id: "saved-project", recording_id: "saved-recording", created_at: "2025-01-01T00:00:00Z", status: "COMPLETE", summary_metrics: {
      duration_seconds: 5, words_per_minute: 120, fillers_per_100_words: 1, pauses_per_speaking_minute: 2,
      rubric_scores: { speaking_rate: 3, filler_words: null, pauses_inside_sentences: 4 },
    } }],
    reviews: { "saved-recording": {
      recording_id: "saved-recording",
      transcript: { text: "Hello.", items: [
        { type: "pronunciation", start_time: "0", end_time: "1", alternatives: [{ content: "Hello" }] },
        { type: "punctuation", alternatives: [{ content: "." }] },
      ] },
      analysis: {
        duration_seconds: 5, words_per_minute: 120, fillers_per_100_words: 1, pauses_per_speaking_minute: 2,
        rubric_scores: { speaking_rate: 3, filler_words: null, pauses_inside_sentences: 4 },
        filler_occurrences: [{ filler: "um", start_seconds: 1, end_seconds: 1.2 }],
        pauses: [{ start_seconds: 2, end_seconds: 2.2 }], long_pauses: [],
      },
      feedback: { feedback: "Keep going", categories: { pace: { observation: "Steady", next_step: "Pause" } }, moments: [
        { id: "m", start_seconds: 0, end_seconds: 1, text: "Hello", kind: "strength", observation: "Clear", next_step: "Repeat" },
      ] },
    } },
  };
}

function Probe() {
  const { ready, projects, recordings, reviews } = useDemoStore();
  return <output data-testid="snapshot">{ready ? `${projects[0]?.project_id}|${recordings[0]?.recording_id}|${Object.keys(reviews)[0]}` : "loading"}</output>;
}

async function restore(value: unknown) {
  localStorage.setItem(storageKey, JSON.stringify(value));
  render(<DemoProvider><Probe /></DemoProvider>);
  await waitFor(() => expect(screen.getByTestId("snapshot").textContent).not.toBe("loading"));
  return screen.getByTestId("snapshot").textContent;
}

beforeEach(() => localStorage.clear());

describe("saved demo state validation", () => {
  it("restores a fully formed project, recording, and review", async () => {
    expect(await restore(savedState())).toBe("saved-project|saved-recording|saved-recording");
  });

  const invalidCases: Array<[string, (state: ReturnType<typeof savedState>) => void]> = [
    ["project field", (state) => { Reflect.set(state.projects[0], "project_title", null); }],
    ["recording identity", (state) => { Reflect.set(state.recordings[0], "recording_id", null); }],
    ["recording status", (state) => { Reflect.set(state.recordings[0], "status", "UNKNOWN"); }],
    ["demo start time", (state) => { Reflect.set(state.recordings[0], "demo_started_at", "today"); }],
    ["audio name", (state) => { Reflect.set(state.recordings[0], "audio_name", 42); }],
    ["failure reason", (state) => { Reflect.set(state.recordings[0], "failure_reason", 42); }],
    ["summary metric", (state) => { Reflect.set(state.recordings[0].summary_metrics, "words_per_minute", "fast"); }],
    ["summary score", (state) => { Reflect.set(state.recordings[0].summary_metrics.rubric_scores, "speaking_rate", "good"); }],
    ["review identity", (state) => { Reflect.set(state.reviews["saved-recording"], "recording_id", null); }],
    ["transcript text", (state) => { Reflect.set(state.reviews["saved-recording"].transcript, "text", null); }],
    ["transcript item", (state) => { state.reviews["saved-recording"].transcript.items[0] = null as never; }],
    ["transcript alternatives", (state) => { Reflect.set(state.reviews["saved-recording"].transcript.items[0], "alternatives", [null]); }],
    ["analysis metrics", (state) => { Reflect.set(state.reviews["saved-recording"].analysis, "duration_seconds", null); }],
    ["analysis occurrences", (state) => { Reflect.set(state.reviews["saved-recording"].analysis, "filler_occurrences", null); }],
    ["analysis span", (state) => { Reflect.set(state.reviews["saved-recording"].analysis, "pauses", [{ start_seconds: "later", end_seconds: 2 }]); }],
    ["filler label", (state) => { Reflect.set(state.reviews["saved-recording"].analysis.filler_occurrences[0], "filler", null); }],
    ["feedback text", (state) => { Reflect.set(state.reviews["saved-recording"].feedback, "feedback", null); }],
    ["feedback category", (state) => { Reflect.set(state.reviews["saved-recording"].feedback.categories.pace, "observation", null); }],
    ["feedback moments", (state) => { Reflect.set(state.reviews["saved-recording"].feedback, "moments", [null]); }],
    ["feedback moment kind", (state) => { Reflect.set(state.reviews["saved-recording"].feedback.moments[0], "kind", "other"); }],
  ];

  it.each(invalidCases)("rejects a malformed %s", async (_label, corrupt) => {
    const state = savedState();
    corrupt(state);
    expect(await restore(state)).not.toContain("saved-project");
  });
});
