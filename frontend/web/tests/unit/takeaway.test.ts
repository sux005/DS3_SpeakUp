import { describe, expect, it } from "vitest";
import { rubric } from "@/lib/rubric";
import { buildEvidence, buildNextStep, buildTakeaway, lowestScored } from "@/lib/takeaway";
import { compareToTarget, targetText } from "@/lib/targets";
import type { AnalysisMetrics, Pause, RecordingReview } from "@/lib/types";
import demoAnalysis from "@/data/demo/analysis.json";
import { summaryMetrics } from "../fixtures";

const demo = demoAnalysis.data.metrics as AnalysisMetrics;
const transcript = { text: "", items: [] };
const scores = (rate: number | null, fillers: number | null, pauses: number | null): AnalysisMetrics =>
  ({ ...demo, rubric_scores: { speaking_rate: rate, filler_words: fillers, pauses_inside_sentences: pauses } });
const uncoached = (metrics?: AnalysisMetrics): RecordingReview => ({ recording_id: "r1", transcript, summary_metrics: summaryMetrics(), analysis: metrics, feedback: null });
const coached = (feedback: NonNullable<RecordingReview["feedback"]>): RecordingReview => ({ recording_id: "r1", transcript, summary_metrics: summaryMetrics(), analysis: demo, feedback });

describe("target helpers", () => {
  it("quotes the rubric's own score-4 wording", () => {
    expect(targetText("speaking_rate")).toBe("135–155 WPM");
    expect(targetText("filler_words")).toBe("fewer than 2");
  });

  it("subtracts, and leaves on-target to the backend's score", () => {
    expect(compareToTarget(134.08, [135, 155], 3)).toBe("0.92 below the target range");
    expect(compareToTarget(11.64, [0, 2], 0)).toBe("9.64 above the target");
    expect(compareToTarget(140, [135, 155], 4)).toBe("In the target range");
    expect(compareToTarget(155, [135, 155], 3)).toBe("At the edge of the target range");
  });
});

describe("takeaway without coaching", () => {
  it("names the best and worst scored measures, each labelled as measured", () => {
    const metrics = scores(3, 0, 2);
    const takeaway = buildTakeaway(uncoached(metrics), metrics);
    expect(takeaway.coached).toBe(false);
    expect(takeaway.overview).toEqual([]);
    expect(takeaway.strength).toEqual({
      label: "Strength",
      title: "Speaking rate",
      text: "134.08 WPM, score 3 of 4. 0.92 below the target range (target: 135–155 WPM).",
      source: "measurements",
    });
    expect(takeaway.priority).toMatchObject({ label: "Work on", title: "Filler words", source: "measurements" });
    expect(takeaway.priority!.text).toBe("11.64 per 100 words, score 0 of 4. 9.64 above the target (target: fewer than 2).");
  });

  it("names every measure that shares the top score instead of picking one", () => {
    // The demo clip: speaking rate and pauses both score 3, fillers 0.
    const takeaway = buildTakeaway(uncoached(demo), demo);
    expect(takeaway.strength).toEqual({
      label: "Strength",
      title: "Speaking rate and pauses inside sentences",
      text: "Both scored 3 of 4.",
      points: [
        "Speaking rate: 134.08 WPM, 0.92 below the target range (target: 135–155 WPM).",
        "Pauses inside sentences: 10.71 per speaking-minute, 1.71 above the target (target: fewer than 9).",
      ],
      source: "measurements",
    });
    expect(takeaway.priority).toMatchObject({ title: "Filler words" });

    const onTarget = buildTakeaway(uncoached(), scores(4, 4, 1));
    expect(onTarget.strength).toMatchObject({ label: "Strength", title: "Speaking rate and filler words" });
    expect(onTarget.strength!.points![0]).toBe("Speaking rate: 134.08 WPM, in the target range.");

    const low = buildTakeaway(uncoached(), scores(2, 0, 2));
    expect(low.strength).toMatchObject({ label: "Closest to target", title: "Speaking rate and pauses inside sentences", text: "Both scored 2 of 4." });
  });

  it("only calls a score of 3 or 4 a strength", () => {
    const takeaway = buildTakeaway(uncoached(), scores(2, 0, 1));
    expect(takeaway.strength).toMatchObject({ label: "Closest to target", title: "Speaking rate" });
    expect(takeaway.priority).toMatchObject({ label: "Work on", title: "Filler words" });
  });

  it("does not single out a strength when every score is level", () => {
    const level = buildTakeaway(uncoached(), scores(2, 2, 2));
    expect(level.strength).toBeUndefined();
    expect(level.priority).toMatchObject({ title: "Speaking rate" });
    expect(level.note).toBe("Your scored measures are level at 2 of 4, so none stands out as a strength yet.");

    const perfect = buildTakeaway(uncoached(), scores(4, 4, 4));
    expect(perfect.strength).toBeUndefined();
    expect(perfect.priority).toBeUndefined();
    expect(perfect.note).toBe("Every scored measure is in the target range.");

    const single = buildTakeaway(uncoached(), scores(null, 1, null));
    expect(single.priority).toMatchObject({ title: "Filler words" });
    expect(single.note).toBeUndefined();
  });

  it("says so when nothing was scored or measured", () => {
    expect(buildTakeaway(uncoached(), scores(null, null, null)).note).toBe("Record at least 60 seconds of speech to get scores.");
    expect(buildTakeaway(uncoached()).note).toBe("No measurements are available for this recording.");
    expect(lowestScored(scores(null, null, null))).toBeUndefined();
  });
});

describe("takeaway with coaching", () => {
  const moments = [
    { id: "m1", start_seconds: 12.5, end_seconds: 14, text: "on the other hand", kind: "improve" as const, observation: "Two fillers in a row.", next_step: "Pause instead." },
    { id: "m2", start_seconds: 40, end_seconds: 44, text: "we propose", kind: "strength" as const, observation: "A clear statement of the idea.", next_step: "Do the same for your result." },
  ];

  it("leads with the coach's summary and moments", () => {
    const takeaway = buildTakeaway(coached({ feedback: "You kept a steady pace.", categories: { general: { observation: "Your structure was clear.", next_step: "Open with your main claim." } }, moments }), demo);
    expect(takeaway.coached).toBe(true);
    expect(takeaway.overview).toEqual(["You kept a steady pace.", "Your structure was clear."]);
    expect(takeaway.strength).toEqual({ label: "Strength", title: "“we propose”", text: "A clear statement of the idea.", source: "coaching", at: 40 });
    expect(takeaway.priority).toEqual({ label: "Work on", title: "“on the other hand”", text: "Two fillers in a row.", source: "coaching", at: 12.5 });
    expect(takeaway.note).toBeUndefined();
  });

  it("fills a missing line from measurements and labels it as such", () => {
    const takeaway = buildTakeaway(coached({ feedback: "Older summary only.", moments: [moments[0]] }), demo);
    expect(takeaway.strength).toMatchObject({ title: "Speaking rate and pauses inside sentences", source: "measurements" });
    expect(takeaway.priority).toMatchObject({ source: "coaching" });
  });

  it("keeps the measurement note when coaching has no moments and nothing is scored", () => {
    const takeaway = buildTakeaway(coached({ feedback: "Summary." }), scores(null, null, null));
    expect(takeaway.note).toBe("Record at least 60 seconds of speech to get scores.");
  });
});

describe("next step", () => {
  it("uses the coach's general next step when there is one", () => {
    const review = coached({ feedback: "x", categories: { general: { observation: "o", next_step: "Open with your main claim." } } });
    expect(buildNextStep(review, demo)).toEqual({ text: "Open with your main claim.", source: "From coaching" });
  });

  it("otherwise gives the rubric tip for the lowest score, and says that is what it is", () => {
    expect(buildNextStep(uncoached(demo), demo)).toEqual({ text: rubric[1].tips[0], source: "Rubric tip for your lowest score: Filler words" });
    expect(buildNextStep(coached({ feedback: "Older summary only." }), demo).source).toBe("Rubric tip for your lowest score: Filler words");
  });

  it("asks for more speech when nothing is scored", () => {
    expect(buildNextStep(uncoached(), scores(null, null, null))).toEqual({ text: "Record at least 60 seconds of speech to get scores and a next step." });
    expect(buildNextStep(uncoached()).source).toBeUndefined();
  });
});

describe("evidence", () => {
  it("lists the coach's moments when there are any", () => {
    const review = coached({ feedback: "x", moments: [{ id: "m1", start_seconds: 3, end_seconds: 4, text: "so", kind: "strength", observation: "Clear.", next_step: "Repeat." }] });
    expect(buildEvidence(review, demo)).toEqual({ source: "coaching", items: [{ at: 3, end: 4, kind: "strength", label: "Strength · “so”", detail: "Clear." }] });
  });

  it("otherwise lists real filler and pause times in order", () => {
    const { items, source } = buildEvidence(uncoached(demo), demo);
    expect(source).toBe("measurements");
    expect(items).toHaveLength(6);
    expect(items.map((item) => item.at)).toEqual([...items.map((item) => item.at)].sort((a, b) => a - b));
    expect(items[0].label).toBe(`Filler “${demo.filler_occurrences[0].filler}”`);
    expect(items.filter((item) => item.label.startsWith("Pause inside a sentence"))).toHaveLength(3);
    // Each item keeps the event's own start and end, straight from the analysis.
    for (const item of items.filter((entry) => entry.kind === "pause")) {
      expect(demo.pauses.some((pause) => pause.start_seconds === item.at && pause.end_seconds === item.end)).toBe(true);
    }
    expect(items.filter((item) => item.kind === "filler")).toHaveLength(3);
  });

  it("uses a pause's own start and end when no duration is given, and skips natural pauses", () => {
    // Older payloads can leave out duration_seconds and inside_sentence, which
    // the API type now requires, so these pauses are cast on purpose.
    const metrics: AnalysisMetrics = { ...demo, filler_occurrences: [], pauses: [
      { start_seconds: 1, end_seconds: 2.5 } as Pause,
      { start_seconds: 5, end_seconds: 9, inside_sentence: false } as Pause,
    ] };
    expect(buildEvidence(uncoached(), metrics).items).toEqual([{ at: 1, end: 2.5, kind: "pause", playFrom: 0, label: "Pause inside a sentence, 1.5 s", detail: "One of the longest" }]);
  });

  it("is empty without measurements or events", () => {
    expect(buildEvidence(uncoached())).toEqual({ items: [] });
    expect(buildEvidence(uncoached(), { ...demo, filler_occurrences: [], pauses: [] })).toEqual({ items: [], source: undefined });
  });
});
