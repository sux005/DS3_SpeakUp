import type { Project, Recording, Take } from "@/lib/types";

export function getProject(projects: Project[], projectId: string) {
  return projects.find((project) => project.project_id === projectId);
}

// Attempt labels are display order; recording_id remains the durable identity.
export function getTakes(recordings: Recording[], projectId: string): Take[] {
  return recordings
    .filter((recording) => recording.project_id === projectId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.recording_id.localeCompare(b.recording_id))
    .map((recording, index) => ({ ...recording, take: index + 1 }));
}

export function getTake(recordings: Recording[], recordingId: string) {
  const recording = recordings.find((item) => item.recording_id === recordingId);
  return recording && getTakes(recordings, recording.project_id).find((take) => take.recording_id === recordingId);
}

export function formatTake(take: number) {
  return `Take ${String(take).padStart(2, "0")}`;
}

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

export function formatScore(score: number | null) {
  return score === null ? "Not scored" : `${score}/4`;
}
