// Ready for connecting to AWS. NOTHING CALLS THIS YET, and it is untested
// against the real API. The pages still read the fake JSON in data/.
// Contract: docs/aws-payload-api.md. Example responses: frontend/sample-payloads/.
//
// To connect:
//   1. Put the API URL in frontend/web/.env.local:
//        NEXT_PUBLIC_SPEAKUP_API_URL=https://...   (SPEAKUP_API_URL in .env.development.example)
//   2. Sign in with Cognito on /login and keep the JWT (ID token).
//   3. Swap the fake imports in lib/recordings.ts and the pages for these calls.

import type { Project, Recording } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_SPEAKUP_API_URL ?? "";

export type ArtifactType = "transcript" | "analysis" | "feedback";

export type UploadReservation = {
  recording: Recording;
  recording_id: string;
  upload_url: string;
  expires_at: string;
  required_headers: Record<string, string>;
  expected_content_length: number;
  max_content_length: number;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  if (!API_URL) throw new Error("NEXT_PUBLIC_SPEAKUP_API_URL is not set");
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, body.code, body.message ?? response.statusText);
  }
  return body as T;
}

export const getProjects = (token: string) =>
  request<{ items: Project[]; next_cursor?: string }>(token, "/projects");

export const getProjectRecordings = (token: string, projectId: string) =>
  request<{ items: Recording[]; next_cursor?: string }>(
    token,
    `/projects/${encodeURIComponent(projectId)}/recordings`,
  );

export const getRecording = (token: string, recordingId: string) =>
  request<Recording>(token, `/recordings/${encodeURIComponent(recordingId)}`);

export const getArtifact = <T>(token: string, recordingId: string, type: ArtifactType) =>
  request<{ recording_id: string; artifact_type: ArtifactType; data: T }>(
    token,
    `/recordings/${encodeURIComponent(recordingId)}/artifacts/${type}`,
  );

// Short-lived link to the original audio, for <audio src>.
// Field name from infra/lambda/api/index.py.
export const getDownloadUrl = (token: string, recordingId: string) =>
  request<{ download_url: string }>(
    token,
    `/recordings/${encodeURIComponent(recordingId)}/download`,
  );

export const getAccountLimits = (token: string) =>
  request<Record<string, number | boolean>>(token, "/account/limits");

// Base64 SHA-256 of the file, which POST /uploads requires.
async function sha256Base64(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

// The whole upload: reserve, PUT the file to S3, then wait for analysis.
// After the PUT, AWS starts processing on its own; the client only polls.
export async function uploadRecording(
  token: string,
  projectId: string,
  file: File,
  onStatus?: (status: string) => void,
) {
  const reservation = await request<UploadReservation>(token, "/uploads", {
    method: "POST",
    body: JSON.stringify({
      project_id: projectId,
      content_type: file.type,
      sha256: await sha256Base64(file),
      content_length: file.size,
      // Same key on a retry = same recording, so retrying never double-uploads.
      idempotency_key: crypto.randomUUID(),
    }),
  });

  const put = await fetch(reservation.upload_url, {
    method: "PUT",
    headers: reservation.required_headers,
    body: file,
  });
  if (!put.ok) throw new ApiError(put.status, "UPLOAD_FAILED", "Uploading the file to S3 failed");

  return waitForRecording(token, reservation.recording_id, onStatus);
}

// Polls GET /recordings/{id} until it is COMPLETE or FAILED.
export async function waitForRecording(
  token: string,
  recordingId: string,
  onStatus?: (status: string) => void,
  everyMs = 3000,
) {
  for (;;) {
    const recording = await getRecording(token, recordingId);
    onStatus?.(recording.status);
    if (recording.status === "COMPLETE" || recording.status === "FAILED") return recording;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}
