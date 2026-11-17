"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import limitsFallback from "@/data/account-limits.json";
import {
  createProject as createApiProject,
  getAccountLimits,
  getDownloadUrl,
  getProjectRecordings,
  getProjects,
  getRecording,
  loadRecordingReview,
  reserveAndUploadRecording,
} from "@/lib/api";
import { useDemoStore } from "@/lib/demo-store";
import type { Project, Recording, RecordingReview } from "@/lib/types";

const live = Boolean(process.env.NEXT_PUBLIC_SPEAKUP_API_URL);

type Limits = typeof limitsFallback;
type Store = {
  live: boolean;
  ready: boolean;
  error: string | null;
  projects: Project[];
  recordings: Recording[];
  reviews: Record<string, RecordingReview>;
  audioUrls: Record<string, string>;
  limits: Limits;
  createProject: (title: string, description: string) => string | Promise<string>;
  createRecording: (projectId: string, audio: Blob, filename: string) => string | Promise<string>;
  refreshRecording: (recordingId: string) => Promise<void>;
  loadReview: (recordingId: string) => Promise<void>;
  loadAudio: (recordingId: string) => Promise<void>;
};

const LiveContext = createContext<Store | null>(null);

function upsertRecording(recordings: Recording[], recording: Recording) {
  const index = recordings.findIndex((item) => item.recording_id === recording.recording_id);
  if (index < 0) return [...recordings, recording];
  const next = [...recordings];
  next[index] = recording;
  return next;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The request failed. Please try again.";
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [reviews, setReviews] = useState<Record<string, RecordingReview>>({});
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [limits, setLimits] = useState<Limits>(limitsFallback);
  const retryKeys = useRef(new WeakMap<Blob, string>());

  const run = useCallback(<T,>(operation: (token: string) => Promise<T>): Promise<T> => operation(""), []);

  const listAll = useCallback(async <T,>(load: (cursor?: string) => Promise<{ items: T[]; next_cursor?: string }>) => {
    const items: T[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await load(cursor);
      items.push(...page.items);
      cursor = page.next_cursor;
      if (cursor && seen.has(cursor)) throw new Error("The API returned a repeated page cursor.");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return items;
  }, []);

  useEffect(() => {
    if (!live) return;
    let active = true;
    queueMicrotask(() => { if (active) setReady(false); });
    const load = async () => {
      try {
        const session = await fetch(`${process.env.NEXT_PUBLIC_SPEAKUP_API_URL}/session`, { cache: "no-store" });
        if (!session.ok) throw new Error("The local analysis session could not start.");
        const [allProjects, nextLimits] = await Promise.all([
          listAll((cursor) => run((jwt) => getProjects(jwt, cursor))),
          run(getAccountLimits),
        ]);
        const byProject = await Promise.all(allProjects.map((project) =>
          listAll((cursor) => run((jwt) => getProjectRecordings(jwt, project.project_id, cursor))),
        ));
        if (!active) return;
        setProjects(allProjects);
        setRecordings(byProject.flat());
        setLimits({ ...limitsFallback, ...nextLimits } as Limits);
        setError(null);
      } catch (failure) {
        if (active) setError(errorMessage(failure));
      } finally {
        if (active) setReady(true);
      }
    };
    void load();
    return () => { active = false; };
  }, [run, listAll]);

  const createProject = useCallback(async (title: string, description: string) => {
    try {
      const project = await run((jwt) => createApiProject(jwt, title, description));
      setProjects((previous) => [...previous, project]);
      setError(null);
      return project.project_id;
    } catch (failure) {
      setError(errorMessage(failure));
      throw failure;
    }
  }, [run]);

  const createRecording = useCallback(async (projectId: string, audio: Blob, filename: string) => {
    try {
      const file = new File([audio], filename, { type: audio.type || "audio/wav" });
      const idempotencyKey = retryKeys.current.get(audio) ?? crypto.randomUUID();
      retryKeys.current.set(audio, idempotencyKey);
      const recordingId = await run((jwt) => reserveAndUploadRecording(jwt, projectId, file, undefined, idempotencyKey));
      const recording = await run((jwt) => getRecording(jwt, recordingId));
      setRecordings((previous) => upsertRecording(previous, recording));
      retryKeys.current.delete(audio);
      setError(null);
      return recordingId;
    } catch (failure) {
      setError(errorMessage(failure));
      throw failure;
    }
  }, [run]);

  const refreshRecording = useCallback(async (recordingId: string) => {
    try {
      const recording = await run((jwt) => getRecording(jwt, recordingId));
      setRecordings((previous) => upsertRecording(previous, recording));
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
      throw failure;
    }
  }, [run]);

  const loadReview = useCallback(async (recordingId: string) => {
    try {
      const review = await run((jwt) => loadRecordingReview(jwt, recordingId));
      setReviews((previous) => ({ ...previous, [recordingId]: review }));
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
      throw failure;
    }
  }, [run]);

  const loadAudio = useCallback(async (recordingId: string) => {
    try {
      const { download_url } = await run((jwt) => getDownloadUrl(jwt, recordingId));
      setAudioUrls((previous) => ({ ...previous, [recordingId]: download_url }));
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
      throw failure;
    }
  }, [run]);

  return <LiveContext.Provider value={{ live, ready, error, projects, recordings, reviews, audioUrls, limits, createProject, createRecording, refreshRecording, loadReview, loadAudio }}>{children}</LiveContext.Provider>;
}

export function useAppStore(): Store {
  const demo = useDemoStore();
  const current = useContext(LiveContext);
  if (live) {
    if (!current) throw new Error("LiveProvider is missing");
    return current;
  }
  return {
    ...demo,
    live: false,
    error: null,
    refreshRecording: async () => {},
    loadReview: async () => {},
    loadAudio: async () => {},
  };
}
