import { describe, expect, it } from "vitest";
import { clusterMoments, momentsFromAnalysis, momentsFromFeedback, nextMoment, type ReviewMoment } from "@/lib/markers";
import type { AnalysisMetrics } from "@/lib/types";
import demoAnalysis from "@/data/demo/analysis.json";

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
      { id: "pause-0", at: 2, end: 2.4, kind: "pause", label: "Pause inside sentence, 0.4 s" },
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
