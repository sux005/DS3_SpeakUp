"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import projectsJson from "@/data/projects.json";
import recordingsJson from "@/data/project-recordings.json";
import transcriptJson from "@/data/transcript.json";
import analysisJson from "@/data/analysis.json";
import feedbackJson from "@/data/feedback.json";
import limitsJson from "@/data/account-limits.json";
import type { Project, Recording, RecordingReview, RecordingStatus } from "@/lib/types";

type DemoState = {
  projects: Project[];
  recordings: Recording[];
  reviews: Record<string, RecordingReview>;
};

type DemoContextValue = DemoState & {
  ready: boolean;
  limits: typeof limitsJson;
  audioUrls: Record<string, string>;
  createProject: (title: string, description: string) => string;
  createRecording: (projectId: string, audio: Blob, filename: string) => string;
};

const STORAGE_KEY = "speakup-frontend-demo-v1";
const seedRecordingId = transcriptJson.recording_id;
if (analysisJson.recording_id !== seedRecordingId || feedbackJson.recording_id !== seedRecordingId) {
  throw new Error("Demo review artifacts must belong to one recording");
}

const initialState: DemoState = {
  projects: projectsJson.items as Project[],
  recordings: recordingsJson.items as Recording[],
  reviews: {
    [seedRecordingId]: {
      recording_id: seedRecordingId,
      transcript: transcriptJson.data,
      analysis: analysisJson.data.metrics,
      feedback: feedbackJson.data,
    } as RecordingReview,
  },
};

const DemoContext = createContext<DemoContextValue | null>(null);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSpan(value: unknown): boolean {
  return isObject(value) && isFiniteNumber(value.start_seconds) && isFiniteNumber(value.end_seconds);
}

function isMetrics(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.rubric_scores)) return false;
  const scores = value.rubric_scores;
  return [value.duration_seconds, value.words_per_minute, value.fillers_per_100_words, value.pauses_per_speaking_minute].every(isFiniteNumber)
    && [scores.speaking_rate, scores.filler_words, scores.pauses_inside_sentences].every((score) => score === null || isFiniteNumber(score));
}

function isReview(value: unknown): boolean {
  if (!isObject(value) || typeof value.recording_id !== "string" || !isObject(value.transcript)) return false;
  const transcript = value.transcript;
  if (typeof transcript.text !== "string" || !Array.isArray(transcript.items) || !transcript.items.every((item) =>
    isObject(item) && typeof item.type === "string" && Array.isArray(item.alternatives)
      && item.alternatives.every((alternative: unknown) => isObject(alternative) && typeof alternative.content === "string")
      && (item.start_time === undefined || typeof item.start_time === "string")
      && (item.end_time === undefined || typeof item.end_time === "string")
  )) return false;
  if (value.analysis !== undefined) {
    if (!isMetrics(value.analysis) || !isObject(value.analysis)) return false;
    if (![value.analysis.filler_occurrences, value.analysis.pauses, value.analysis.long_pauses].every(Array.isArray)) return false;
    if (!(value.analysis.filler_occurrences as unknown[]).every((span) => isSpan(span) && isObject(span) && typeof span.filler === "string")) return false;
    if (!(value.analysis.pauses as unknown[]).every(isSpan) || !(value.analysis.long_pauses as unknown[]).every(isSpan)) return false;
  }
  if (value.feedback !== null && value.feedback !== undefined) {
    if (!isObject(value.feedback) || typeof value.feedback.feedback !== "string") return false;
    if (value.feedback.categories !== undefined && (!isObject(value.feedback.categories) || !Object.values(value.feedback.categories).every((category) =>
      isObject(category) && typeof category.observation === "string" && typeof category.next_step === "string"
    ))) return false;
    if (value.feedback.moments !== undefined && (!Array.isArray(value.feedback.moments) || !value.feedback.moments.every((moment: unknown) =>
      isSpan(moment) && isObject(moment) && typeof moment.id === "string" && typeof moment.text === "string"
        && (moment.kind === "strength" || moment.kind === "improve")
        && typeof moment.observation === "string" && typeof moment.next_step === "string"
    ))) return false;
  }
  return true;
}

const statuses: RecordingStatus[] = ["AWAITING_UPLOAD", "UPLOADED", "PROCESSING", "TRANSCRIBING", "ANALYZED", "COMPLETE", "FAILED", "DELETED", "PURGE_PENDING"];

function isDemoState(value: unknown): value is DemoState {
  if (!isObject(value) || !Array.isArray(value.projects) || !Array.isArray(value.recordings) || !isObject(value.reviews)) return false;
  return value.projects.every((project: unknown) => isObject(project)
      && [project.project_id, project.project_title, project.description, project.created_at].every((field) => typeof field === "string"))
    && value.recordings.every((recording: unknown) => isObject(recording)
      && [recording.project_id, recording.recording_id, recording.created_at].every((field) => typeof field === "string")
      && statuses.includes(recording.status as RecordingStatus)
      && (recording.demo_started_at === undefined || isFiniteNumber(recording.demo_started_at))
      && (recording.audio_name === undefined || typeof recording.audio_name === "string")
      && (recording.failure_reason === undefined || typeof recording.failure_reason === "string")
      && (recording.summary_metrics === undefined || isMetrics(recording.summary_metrics)))
    && Object.values(value.reviews).every(isReview);
}

function currentStatus(recording: Recording, now: number): RecordingStatus {
  if (recording.demo_started_at === undefined) return recording.status;
  const elapsed = now - recording.demo_started_at;
  if (elapsed < 3_000) return "PROCESSING";
  if (elapsed < 6_000) return "TRANSCRIBING";
  if (elapsed < 9_000) return "ANALYZED";
  return "COMPLETE";
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(initialState);
  const [ready, setReady] = useState(false);
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const createdUrls = useRef<string[]>([]);

  useEffect(() => {
    let restored = initialState;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (isDemoState(parsed)) restored = parsed;
      }
    } catch {
      // A blocked or old browser store should not prevent the demo from opening.
    }
    restored = {
      ...restored,
      recordings: restored.recordings.map((recording) =>
        recording.status === "TRANSCRIBING" && !recording.demo_started_at
          ? { ...recording, demo_started_at: Date.now() - 3_000 }
          : recording
      ),
    };
    queueMicrotask(() => {
      setState(restored);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // The demo still works for this tab if browser storage is unavailable.
    }
  }, [ready, state]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setState((previous) => {
        let changed = false;
        const recordings = previous.recordings.map((recording) => {
          const status = currentStatus(recording, now);
          if (status === recording.status) return recording;
          changed = true;
          return { ...recording, status, updated_at: new Date(now).toISOString() };
        });
        return changed ? { ...previous, recordings } : previous;
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [ready]);

  useEffect(() => {
    const urls = createdUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function createProject(title: string, description: string) {
    const id = `project-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const project: Project = {
      project_id: id,
      project_title: title.trim(),
      description: description.trim(),
      created_at: now,
    };
    setState((previous) => ({ ...previous, projects: [...previous.projects, project] }));
    return id;
  }

  function createRecording(projectId: string, audio: Blob, filename: string) {
    const id = crypto.randomUUID();
    const now = Date.now();
    const recording: Recording = {
      project_id: projectId,
      recording_id: id,
      created_at: new Date(now).toISOString(),
      status: "PROCESSING",
      demo_started_at: now,
      audio_name: filename,
    };
    const url = URL.createObjectURL(audio);
    createdUrls.current.push(url);
    setAudioUrls((previous) => ({ ...previous, [id]: url }));
    setState((previous) => ({ ...previous, recordings: [...previous.recordings, recording] }));
    return id;
  }

  return (
    <DemoContext.Provider value={{ ...state, ready, limits: limitsJson, audioUrls, createProject, createRecording }}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemoStore() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("DemoProvider is missing");
  return value;
}
