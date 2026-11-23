"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import limitsFallback from "@/data/account-limits.json";
import {
  ApiError,
  createProject as createApiProject,
  EXAMPLE_PROJECT_ID,
  getExampleDownloadUrl,
  getExampleRecording,
  getExamples,
  getAccountLimits,
  getDownloadUrl,
  getProjectRecordings,
  getProjects,
  getRecording,
  isExampleRecording,
  loadRecordingReview,
  reserveAndUploadRecording,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
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

  const { configured: accounts, ready: authReady, user, getAccessToken } = useAuth();
  const owner = user?.sub ?? null;

  // With accounts set up, every call carries the signed-in person's Cognito access token
  // and the deployed API scopes data to them. Without accounts, the token stays empty and
  // the local development guest bridge supplies a guest identity instead.
  const run = useCallback(async <T,>(operation: (token: string) => Promise<T>): Promise<T> => {
    if (!accounts) return operation("");
    const token = await getAccessToken();
    if (!token) throw new Error("Sign in to load your presentations.");
    return operation(token);
  }, [accounts, getAccessToken]);

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
    if (!live || !authReady) return;
    let active = true;
    // Signed out with accounts set up: nothing to load until someone signs in.
    if (accounts && !owner) {
      queueMicrotask(() => {
        if (!active) return;
        setProjects([]);
        setRecordings([]);
        setReviews({});
        setAudioUrls({});
        setError(null);
        setReady(true);
      });
      return () => { active = false; };
    }
    queueMicrotask(() => {
      if (!active) return;
      // A different person may have signed in: drop the last person's cached reviews and audio links.
      setReviews({});
      setAudioUrls({});
      setReady(false);
    });
    const load = async () => {
      try {
        if (!accounts) {
          const session = await fetch(`${process.env.NEXT_PUBLIC_SPEAKUP_API_URL}/session`, { cache: "no-store" });
          if (!session.ok) throw new Error("The local analysis session could not start.");
        }
        const [allProjects, nextLimits, examples] = await Promise.all([
          listAll((cursor) => run((jwt) => getProjects(jwt, cursor))),
          run(getAccountLimits),
          run(getExamples).catch((failure) => {
            if (failure instanceof ApiError && failure.status === 404) return null;
            throw failure;
          }),
        ]);
        const byProject = await Promise.all(allProjects.map((project) =>
          listAll((cursor) => run((jwt) => getProjectRecordings(jwt, project.project_id, cursor))),
        ));
        if (!active) return;
        setProjects(examples ? [...allProjects.filter((project) => project.project_id !== EXAMPLE_PROJECT_ID), examples.project] : allProjects);
        setRecordings(examples ? [...byProject.flat(), ...examples.recordings] : byProject.flat());
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
  }, [run, listAll, accounts, authReady, owner]);

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
    if (projectId === EXAMPLE_PROJECT_ID) throw new Error("Example speeches are read-only.");
    try {
      const file = new File([audio], filename, { type: audio.type || "audio/wav" });
      const idempotencyKey = retryKeys.current.get(audio) ?? crypto.randomUUID();
      retryKeys.current.set(audio, idempotencyKey);
      const recordingId = await run((jwt) => reserveAndUploadRecording(jwt, projectId, file, undefined, idempotencyKey));
      const recording = await run((jwt) => isExampleRecording(recordingId) ? getExampleRecording(jwt, recordingId) : getRecording(jwt, recordingId));
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
      const recording = await run((jwt) => isExampleRecording(recordingId) ? getExampleRecording(jwt, recordingId) : getRecording(jwt, recordingId));
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
      const { download_url } = await run((jwt) => isExampleRecording(recordingId) ? getExampleDownloadUrl(jwt, recordingId) : getDownloadUrl(jwt, recordingId));
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
