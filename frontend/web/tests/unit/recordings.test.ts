import { describe, expect, it } from "vitest";
import { formatClock, formatDate, formatScore, formatTake, getProject, getTake, getTakes } from "@/lib/recordings";
import type { Project, Recording } from "@/lib/types";

const project = (id: string): Project => ({ project_id: id, project_title: id, description: "", created_at: "2025-01-01T00:00:00.000Z" });
const recording = (id: string, projectId: string, createdAt: string): Recording => ({
  project_id: projectId,
  recording_id: id,
  created_at: createdAt,
  status: "COMPLETE",
});

describe("recording selectors", () => {
  it("finds projects and returns undefined for an unknown id", () => {
    expect(getProject([project("p1")], "p1")?.project_id).toBe("p1");
    expect(getProject([project("p1")], "missing")).toBeUndefined();
  });

  it("sorts takes chronologically, then by durable id, without mutating input", () => {
    const source = [recording("b", "p1", "2025-01-02T00:00:00.000Z"), recording("a", "p1", "2025-01-01T00:00:00.000Z"), recording("c", "p2", "2025-01-01T00:00:00.000Z")];
    const copy = [...source];
    expect(getTakes(source, "p1").map((take) => [take.recording_id, take.take])).toEqual([["a", 1], ["b", 2]]);
    expect(source).toEqual(copy);
    expect(getTakes(source, "missing")).toEqual([]);
  });

  it("uses recording identity to find a take and handles missing recordings", () => {
    const source = [recording("one", "p1", "2025-01-01T00:00:00.000Z"), recording("two", "p1", "2025-01-02T00:00:00.000Z")];
    expect(getTake(source, "two")).toMatchObject({ recording_id: "two", take: 2 });
    expect(getTake(source, "missing")).toBeUndefined();
  });
});

describe("recording formatters", () => {
  it.each([[0, "00:00"], [1.9, "00:01"], [65, "01:05"], [3605, "60:05"]])("formats %s seconds as %s", (seconds, expected) => {
    expect(formatClock(seconds)).toBe(expected);
  });

  it("formats take numbers and nullable scores", () => {
    expect(formatTake(1)).toBe("Take 01");
    expect(formatTake(12)).toBe("Take 12");
    expect(formatScore(0)).toBe("0/4");
    expect(formatScore(null)).toBe("Not scored");
  });

  it("formats UTC dates consistently with and without year", () => {
    expect(formatDate("2025-06-15T23:30:00.000Z")).toBe("Jun 15");
    expect(formatDate("2025-06-15T23:30:00.000Z", true)).toBe("Jun 15, 2025");
  });
});
