// Fields used by the local demo, based on the sample API payloads in data/.
// Demo-only recording fields are included below; this is not a complete API DTO.
// See docs/aws-payload-api.md before connecting the backend.

export type Project = {
  project_id: string;
  project_title: string;
  description: string;
  created_at: string;
};

export type RecordingStatus =
  | "AWAITING_UPLOAD"
  | "UPLOADED"
  | "PROCESSING"
  | "TRANSCRIBING"
  | "ANALYZED"
  | "COMPLETE"
  | "FAILED"
  | "DELETED"
  | "PURGE_PENDING";

export type SummaryMetrics = {
  duration_seconds: number;
  words_per_minute: number;
  fillers_per_100_words: number;
  pauses_per_speaking_minute: number;
  // Optional: older payloads and the short example may leave these out.
  filler_count?: number;
  // Scored filler counts by word, e.g. { um: 11, uh: 21 }.
  filler_words?: Record<string, number>;
  // Watch-list words (e.g. "like") are counted but not scored, and the
  // analysis gives no times for them.
  watch_words?: Record<string, number>;
  pauses_inside_sentences?: number;
  pauses_between_sentences?: number;
  rubric_scores: {
    speaking_rate: number | null;
    filler_words: number | null;
    pauses_inside_sentences: number | null;
  };
};

export type Recording = {
  project_id: string;
  recording_id: string;
  created_at: string;
  status: RecordingStatus;
  summary_metrics?: SummaryMetrics;
  failure_reason?: string;
  demo_started_at?: number;
  audio_name?: string;
};

// A recording plus its attempt number within its project, counting from 1.
export type Take = Recording & { take: number };

export type TimeSpan = { start_seconds: number; end_seconds: number };

// inside_sentence is set by the backend scorer: true for a pause in the middle
// of a sentence (scored), false for a natural pause between sentences.
export type Pause = TimeSpan & { duration_seconds?: number; inside_sentence?: boolean };

export type AnalysisMetrics = SummaryMetrics & {
  filler_occurrences: (TimeSpan & { filler: string })[];
  pauses: Pause[];
  long_pauses: Pause[];
};

export type TranscriptItem = {
  type: string;
  start_time?: string;
  end_time?: string;
  alternatives: { content: string }[];
};

export type FeedbackCategory = {
  observation: string;
  next_step: string;
};

export type FeedbackMoment = {
  id: string;
  start_seconds: number;
  end_seconds: number;
  text: string;
  kind: "strength" | "improve";
  observation: string;
  next_step: string;
};

export type RecordingReview = {
  recording_id: string;
  transcript: { text: string; items: TranscriptItem[] };
  analysis?: AnalysisMetrics;
  feedback: {
    feedback: string;
    schema_version?: number;
    categories?: Partial<Record<"general" | "pace" | "fillers" | "pauses", FeedbackCategory>>;
    moments?: FeedbackMoment[];
  } | null;
};
