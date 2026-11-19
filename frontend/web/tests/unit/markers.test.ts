import { describe, expect, it } from "vitest";
import { clusterMoments, momentsFromAnalysis, momentsFromFeedback, nextMoment, PAUSE_LEAD_IN_SECONDS, pauseReplayStart, replayStart, type ReviewMoment } from "@/lib/markers";
import { wordTimes } from "@/lib/transcript";
import type { AnalysisMetrics } from "@/lib/types";
import demoAnalysis from "@/data/demo/analysis.json";
import demoTranscript from "@/data/demo/transcript.json";

const metrics = {
  duration_seconds: 20,
  words_per_minute: 140,
  fillers_per_100_words: 1,
  pauses_per_speaking_minute: 1,
  rubric_scores: { speaking_rate: 4, filler_words: 4, pauses_inside_sentences: 4 },
  filler_occurrences: [{ filler: "um", start_seconds: 5, end_seconds: 5.3 }],
  pauses: [
    { start_seconds: 2, end_seconds: 2.4, duration_seconds: 0.4, inside_sentence: true },
    { start_seconds: 9, end_seconds: 10, inside_sentence: false },
  ],
  long_pauses: [],
} satisfies AnalysisMetrics;

const at = (seconds: number): ReviewMoment => ({ at: seconds, label: `m${seconds}` });

describe("momentsFromAnalysis", () => {
  it("marks fillers and pauses inside sentences, in time order, but not natural pauses", () => {
    expect(momentsFromAnalysis(metrics)).toEqual([
      // No transcript words here, so the pause gets the one-second lead-in.
      { id: "pause-0", at: 2, end: 2.4, kind: "pause", playFrom: 1, label: "Pause inside sentence, 0.4 s" },
      { id: "filler-0", at: 5, end: 5.3, kind: "filler", label: "Filler “um”" },
    ]);
  });

  it("returns nothing without analysis", () => {
    expect(momentsFromAnalysis(undefined)).toEqual([]);
  });

  it("matches the real demo analysis counts", () => {
    const demo = demoAnalysis.data.metrics as AnalysisMetrics;
    const moments = momentsFromAnalysis(demo);
    expect(moments.filter((moment) => moment.kind === "filler")).toHaveLength(demo.filler_occurrences.length);
    expect(moments.filter((moment) => moment.kind === "pause")).toHaveLength(demo.pauses_inside_sentences ?? -1);
  });
});

describe("pauseReplayStart", () => {
  // "I want [pause] food"
  const words = [{ start: 7.0, end: 7.2 }, { start: 7.4, end: 8.0 }, { start: 8.8, end: 9.3 }];

  it("starts at the beginning of the word right before the pause", () => {
    expect(pauseReplayStart(8.0, words)).toBe(7.4);
  });

  it("still finds that word when Transcribe stretches it over the pause, or lists words out of order", () => {
    expect(pauseReplayStart(8.0, [{ start: 8.8, end: 9.3 }, { start: 7.4, end: 8.3 }, { start: 7.0, end: 7.2 }])).toBe(7.4);
  });

  it("falls back to a short lead-in, clamped to zero, when no word comes before the pause", () => {
    expect(PAUSE_LEAD_IN_SECONDS).toBe(1);
    expect(pauseReplayStart(5, [])).toBe(4);
    expect(pauseReplayStart(5)).toBe(4);
    expect(pauseReplayStart(6.5, words)).toBe(5.5);
    expect(pauseReplayStart(0.6, words)).toBe(0);
    expect(pauseReplayStart(0)).toBe(0);
  });
});

describe("replayStart", () => {
  it("uses a moment's playFrom when it has one", () => {
    expect(replayStart({ at: 8, kind: "pause", playFrom: 7.4 })).toBe(7.4);
  });

  it("gives a pause without playFrom the short lead-in, clamped to zero", () => {
    expect(replayStart({ at: 15.16, kind: "pause" })).toBeCloseTo(14.16);
    expect(replayStart({ at: 0.8, kind: "pause" })).toBe(0);
  });

  it("leaves fillers, coaching moments and untyped moments at their own time", () => {
    expect(replayStart({ at: 12.5, kind: "filler" })).toBe(12.5);
    expect(replayStart({ at: 12.5, kind: "strength" })).toBe(12.5);
    expect(replayStart({ at: 12.5, kind: "improve" })).toBe(12.5);
    expect(replayStart({ at: 12.5 })).toBe(12.5);
  });

  it("starts every scored pause in the demo clip at the word just before it", () => {
    const words = wordTimes(demoTranscript.data.items);
    const pauses = momentsFromAnalysis(demoAnalysis.data.metrics as AnalysisMetrics, words).filter((moment) => moment.kind === "pause");
    expect(pauses.length).toBeGreaterThan(0);
    for (const pause of pauses) {
      const before = words.filter((word) => word.start < pause.at).at(-1)!;
      expect(replayStart(pause)).toBe(before.start);
      // That word leads straight into the pause, so the silence is heard in full.
      expect(before.end).toBeCloseTo(pause.at, 1);
    }
  });
});

describe("momentsFromFeedback", () => {
  it("keeps the coaching observation and next step", () => {
    expect(momentsFromFeedback([{ id: "m1", start_seconds: 1, end_seconds: 2, text: "Opening", kind: "strength", observation: "Clear", next_step: "Repeat" }]))
      .toEqual([{ id: "m1", at: 1, end: 2, label: "Strength", text: "Opening", kind: "strength", observation: "Clear", nextStep: "Repeat" }]);
    expect(momentsFromFeedback(undefined)).toEqual([]);
  });
});

describe("clusterMoments", () => {
  it("keeps far-apart moments separate at their own positions", () => {
    const clusters = clusterMoments([at(10), at(50)], 100, 1000);
    expect(clusters.map((cluster) => [cluster.percent, cluster.moments.length])).toEqual([[10, 1], [50, 1]]);
  });

  it("merges moments closer than the minimum gap and centres the group", () => {
    const clusters = clusterMoments([at(11), at(10), at(12), at(40)], 100, 1000);
    expect(clusters.map((cluster) => cluster.moments.map((moment) => moment.at))).toEqual([[10, 11, 12], [40]]);
    expect(clusters[0].percent).toBeCloseTo(11);
  });

  it("merges more on a narrow timeline", () => {
    expect(clusterMoments([at(10), at(14)], 100, 1000)).toHaveLength(2);
    expect(clusterMoments([at(10), at(14)], 100, 300)).toHaveLength(1);
  });

  it("never leaves two clusters closer than the minimum gap", () => {
    const moments = [0, 2.3, 2.6, 4.9, 5.2, 7.5, 9.8, 12.1, 30, 31, 33].map(at);
    const clusters = clusterMoments(moments, 100, 1000);
    const gaps = clusters.slice(1).map((cluster, index) => (cluster.percent - clusters[index].percent) * 10);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(24);
    expect(clusters.reduce((sum, cluster) => sum + cluster.moments.length, 0)).toBe(moments.length);
  });

  it("drops moments outside the recording and handles an unknown size", () => {
    expect(clusterMoments([at(-1), at(150), at(Number.NaN), at(5)], 100, 1000)).toHaveLength(1);
    expect(clusterMoments([at(5)], 0, 1000)).toEqual([]);
    expect(clusterMoments([at(5)], 100, 0)).toEqual([]);
  });
});

describe("nextMoment", () => {
  const moments = [at(5), at(10), at(20)];
  it("finds the next and previous moments, skipping the one just reached", () => {
    expect(nextMoment(moments, 10, 1)?.at).toBe(20);
    expect(nextMoment(moments, 10, -1)?.at).toBe(5);
    expect(nextMoment(moments, 0, -1)).toBeUndefined();
    expect(nextMoment(moments, 25, 1)).toBeUndefined();
  });
});
