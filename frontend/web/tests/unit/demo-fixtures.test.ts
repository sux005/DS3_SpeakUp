import { describe, expect, it } from "vitest";
import projects from "@/data/projects.json";
import recordings from "@/data/project-recordings.json";
import transcript from "@/data/transcript.json";
import analysis from "@/data/analysis.json";
import feedback from "@/data/feedback.json";

describe("local demo fixture contract", () => {
  it("keeps project and recording identities unique and linked", () => {
    const projectIds = projects.items.map((project) => project.project_id);
    const recordingIds = recordings.items.map((recording) => recording.recording_id);
    expect(new Set(projectIds).size).toBe(projectIds.length);
    expect(new Set(recordingIds).size).toBe(recordingIds.length);
    for (const recording of recordings.items) {
      expect(projectIds).toContain(recording.project_id);
    }
  });

  it("attaches transcript, analysis, and feedback to the same completed recording", () => {
    expect(analysis.recording_id).toBe(transcript.recording_id);
    expect(feedback.recording_id).toBe(transcript.recording_id);
    expect(recordings.items.find((recording) => recording.recording_id === transcript.recording_id)?.status).toBe("COMPLETE");
  });

  it("keeps transcript and analysis times within the recording duration", () => {
    const duration = analysis.data.metrics.duration_seconds;
    expect(duration).toBeGreaterThan(0);
    for (const item of transcript.data.items) {
      if (item.type !== "pronunciation") continue;
      const start = Number(item.start_time);
      const end = Number(item.end_time);
      expect(Number.isFinite(start) && Number.isFinite(end)).toBe(true);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThanOrEqual(start);
      expect(end).toBeLessThanOrEqual(duration);
    }
    for (const span of [...analysis.data.metrics.filler_occurrences, ...analysis.data.metrics.pauses]) {
      expect(span.start_seconds).toBeGreaterThanOrEqual(0);
      expect(span.end_seconds).toBeGreaterThanOrEqual(span.start_seconds);
      expect(span.end_seconds).toBeLessThanOrEqual(duration);
    }
  });
});
