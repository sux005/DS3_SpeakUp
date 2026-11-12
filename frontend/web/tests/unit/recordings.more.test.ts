import { describe, expect, it } from "vitest";
import { formatClock, formatDate, formatScore, formatTake, getTake, getTakes } from "@/lib/recordings";
import type { Recording } from "@/lib/types";

const recording = (id: string, projectId: string, createdAt: string, status: Recording["status"] = "COMPLETE"): Recording => ({
  recording_id: id,
  project_id: projectId,
  created_at: createdAt,
  status,
});

describe("recording helper boundaries", () => {
  it("keeps takes isolated by project and assigns stable labels", () => {
    const recordings = [
      recording("same-time-b", "p1", "2025-01-01T00:00:00.000Z"),
      recording("same-time-a", "p1", "2025-01-01T00:00:00.000Z"),
      recording("other", "p2", "2025-01-01T00:00:00.000Z"),
    ];
    expect(getTakes(recordings, "p1").map(({ recording_id, take }) => ({ recording_id, take }))).toEqual([
      { recording_id: "same-time-a", take: 1 },
      { recording_id: "same-time-b", take: 2 },
    ]);
    expect(getTake(recordings, "other")).toMatchObject({ recording_id: "other", take: 1 });
  });

  it("handles exact formatting boundaries", () => {
    expect(formatClock(59.999)).toBe("00:59");
    expect(formatClock(60)).toBe("01:00");
    expect(formatTake(100)).toBe("Take 100");
    expect(formatScore(4)).toBe("4/4");
    expect(formatDate("invalid-date")).toBe("Invalid Date");
  });

  it("does not mutate a caller-owned recording array when sorting", () => {
    const recordings = [
      recording("later", "p", "2025-02-01T00:00:00.000Z"),
      recording("earlier", "p", "2025-01-01T00:00:00.000Z"),
    ];
    const originalIds = recordings.map((item) => item.recording_id);
    getTakes(recordings, "p");
    expect(recordings.map((item) => item.recording_id)).toEqual(originalIds);
  });
});
