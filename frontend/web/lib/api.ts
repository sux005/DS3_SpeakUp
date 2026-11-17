// API client used by the live provider through the local guest bridge.
// Contract: docs/aws-payload-api.md. Example responses: frontend/sample-payloads/.

import type { AnalysisMetrics, Project, Recording, RecordingFeedback, RecordingReview } from "@/lib/types";

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

export type AuthenticatedApiClient = {
  getProjects: (cursor?: string) => ReturnType<typeof getProjects>;
  createProject: (projectTitle: string, description?: string) => ReturnType<typeof createProject>;
  getProjectRecordings: (projectId: string, cursor?: string) => ReturnType<typeof getProjectRecordings>;
  getRecording: (recordingId: string) => ReturnType<typeof getRecording>;
  getRecordingReview: (recordingId: string) => ReturnType<typeof getRecordingReview>;
  getReview: (recordingId: string) => ReturnType<typeof getReview>;
  loadRecordingReview: (recordingId: string) => ReturnType<typeof loadRecordingReview>;
  getArtifact: <T>(recordingId: string, type: ArtifactType) => ReturnType<typeof getArtifact<T>>;
  getDownloadUrl: (recordingId: string) => ReturnType<typeof getDownloadUrl>;
  getAccountLimits: () => ReturnType<typeof getAccountLimits>;
  reserveAndUploadRecording: (
    projectId: string,
    file: File,
    onStatus?: (status: string) => void,
    idempotencyKey?: string,
  ) => ReturnType<typeof reserveAndUploadRecording>;
  uploadRecording: (
    projectId: string,
    file: File,
    onStatus?: (status: string) => void,
    idempotencyKey?: string,
  ) => ReturnType<typeof uploadRecording>;
  waitForRecording: (
    recordingId: string,
    onStatus?: (status: string) => void,
    everyMs?: number,
  ) => ReturnType<typeof waitForRecording>;
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

export const getProjects = (token: string, cursor?: string) =>
  request<{ items: Project[]; next_cursor?: string }>(
    token,
    cursor ? `/projects?cursor=${encodeURIComponent(cursor)}` : "/projects",
  );

export const createProject = (token: string, projectTitle: string, description = "") =>
  request<Project>(token, "/projects", {
    method: "POST",
    body: JSON.stringify({ project_title: projectTitle, description }),
  });

export const getProjectRecordings = (token: string, projectId: string, cursor?: string) =>
  request<{ items: Recording[]; next_cursor?: string }>(
    token,
    `/projects/${encodeURIComponent(projectId)}/recordings${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
  );

export const getRecording = (token: string, recordingId: string) =>
  request<Recording>(token, `/recordings/${encodeURIComponent(recordingId)}`);

export type RecordingReviewResponse = Omit<RecordingReview, "analysis"> & {
  summary_metrics?: RecordingReview["summary_metrics"];
};

/** Convert the API's completed-review envelope into the UI review shape. */
export function normalizeReview(response: RecordingReviewResponse): RecordingReview {
  return {
    recording_id: response.recording_id,
    transcript: response.transcript,
    summary_metrics: response.summary_metrics,
    feedback: response.feedback,
  };
}

export const getRecordingReview = (token: string, recordingId: string) =>
  request<RecordingReviewResponse>(
    token,
    `/recordings/${encodeURIComponent(recordingId)}/review`,
  );

export const getReview = async (token: string, recordingId: string) =>
  normalizeReview(await getRecordingReview(token, recordingId));

type AnalysisArtifact = { metrics: AnalysisMetrics };

/** Load the review envelope and detailed analysis into the UI's review shape. */
export async function loadRecordingReview(token: string, recordingId: string): Promise<RecordingReview> {
  let review: RecordingReviewResponse;
  try {
    review = await getRecordingReview(token, recordingId);
  } catch (error) {
    // Only a missing review route selects the older deployed API contract.
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    const [recording, transcript, analysis] = await Promise.all([
      getRecording(token, recordingId),
      getArtifact<RecordingReview["transcript"]>(token, recordingId, "transcript"),
      getArtifact<AnalysisArtifact>(token, recordingId, "analysis"),
    ]);
    let feedback: RecordingFeedback | null = null;
    try {
      feedback = (await getArtifact<RecordingFeedback>(token, recordingId, "feedback")).data;
    } catch (feedbackError) {
      if (!(feedbackError instanceof ApiError) || feedbackError.status !== 404) throw feedbackError;
    }
    return {
      recording_id: recordingId,
      transcript: transcript.data,
      summary_metrics: recording.summary_metrics,
      analysis: analysis.data.metrics,
      feedback,
    };
  }
  const artifact = await getArtifact<AnalysisArtifact>(token, recordingId, "analysis");
  return { ...normalizeReview(review), analysis: artifact.data.metrics };
}

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
export async function reserveAndUploadRecording(
  token: string,
  projectId: string,
  file: File,
  onStatus?: (status: string) => void,
  idempotencyKey = crypto.randomUUID(),
) {
  const reservation = await request<UploadReservation>(token, "/uploads", {
    method: "POST",
    body: JSON.stringify({
      project_id: projectId,
      content_type: file.type,
      sha256: await sha256Base64(file),
      content_length: file.size,
      // Same key on a retry = same recording, so retrying never double-uploads.
      // Callers should reuse this key when retrying the same file. The API
      // derives the recording ID from it, making reservation retries safe.
      idempotency_key: idempotencyKey,
    }),
  });

  const put = await fetch(reservation.upload_url, {
    method: "PUT",
    headers: reservation.required_headers,
    body: file,
  });
  if (!put.ok) throw new ApiError(put.status, "UPLOAD_FAILED", "Uploading the file to S3 failed");

  return reservation.recording_id;
}

export async function uploadRecording(
  token: string,
  projectId: string,
  file: File,
  onStatus?: (status: string) => void,
  idempotencyKey = crypto.randomUUID(),
) {
  const recordingId = await reserveAndUploadRecording(token, projectId, file, onStatus, idempotencyKey);
  return waitForRecording(token, recordingId, onStatus);
}

/** Bind an optional bearer token for callers that make several requests. */
export function createApiClient(token: string): AuthenticatedApiClient {
  return {
    getProjects: (cursor) => getProjects(token, cursor),
    createProject: (projectTitle, description) => createProject(token, projectTitle, description),
    getProjectRecordings: (projectId, cursor) => getProjectRecordings(token, projectId, cursor),
    getRecording: (recordingId) => getRecording(token, recordingId),
    getRecordingReview: (recordingId) => getRecordingReview(token, recordingId),
    getReview: (recordingId) => getReview(token, recordingId),
    loadRecordingReview: (recordingId) => loadRecordingReview(token, recordingId),
    getArtifact: (recordingId, type) => getArtifact(token, recordingId, type),
    getDownloadUrl: (recordingId) => getDownloadUrl(token, recordingId),
    getAccountLimits: () => getAccountLimits(token),
    reserveAndUploadRecording: (projectId, file, onStatus, idempotencyKey) =>
      reserveAndUploadRecording(token, projectId, file, onStatus, idempotencyKey),
    uploadRecording: (projectId, file, onStatus, idempotencyKey) =>
      uploadRecording(token, projectId, file, onStatus, idempotencyKey),
    waitForRecording: (recordingId, onStatus, everyMs) =>
      waitForRecording(token, recordingId, onStatus, everyMs),
  };
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
