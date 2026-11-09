import projectsJson from "@/data/projects.json";
import recordingsJson from "@/data/project-recordings.json";
import type { Project, Recording, Take } from "@/lib/types";

// Fake data for now. When the app talks to AWS, these come from
// GET /projects and GET /projects/{projectId}/recordings.
export const projects = projectsJson.items as Project[];
export const recordings = recordingsJson.items as Recording[];

export function getProject(projectId: string) {
  return projects.find((project) => project.project_id === projectId);
}

// Oldest first, so the first recording is Take 01.
export function getTakes(projectId: string): Take[] {
  return recordings
    .filter((recording) => recording.project_id === projectId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((recording, index) => ({ ...recording, take: index + 1 }));
}

export function getTake(recordingId: string) {
  const recording = recordings.find((r) => r.recording_id === recordingId);
  if (!recording) return undefined;
  return getTakes(recording.project_id).find((t) => t.recording_id === recordingId);
}

export function formatTake(take: number) {
  return `Take ${String(take).padStart(2, "0")}`;
}

// 66 seconds -> "01:06"
export function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function formatDate(iso: string, withYear = false) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

// Scores are null when a recording has under 60 seconds of speech.
export function formatScore(score: number | null) {
  return score === null ? "Not scored" : `${score}/4`;
}
