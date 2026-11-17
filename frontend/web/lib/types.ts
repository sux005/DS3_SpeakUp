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

// "insufficient_speech" means the talk was too short to score, so every
// rubric score is null.
export type RubricStatus = "scored" | "insufficient_speech";

export type PauseDetectionMethod =
  | "energy_or_silero_and_word_gap"
  | "energy_only"
  | "transcribe_word_gaps";

export type SummaryMetrics = {
  rubric_version: string;
  rubric_status: RubricStatus;
  pause_detection_method: PauseDetectionMethod;
  transcribed_word_count: number;
  word_count: number;
  duration_seconds: number;
  speaking_duration_seconds: number;
  words_per_minute: number;
  filler_words: Record<string, number>;
  filler_count: number;
  fillers_per_100_words: number;
  // Words like "like" that are counted but not scored.
  watch_words: Record<string, number>;
  pauses_inside_sentences: number;
  pauses_between_sentences: number;
  pauses_per_speaking_minute: number;
  total_pause_seconds: number;
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

export type Pause = TimeSpan & { duration_seconds: number; inside_sentence: boolean };

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

// GET /recordings/{id}/review. See frontend/sample-payloads/review.json.
export type RecordingReview = {
  recording_id: string;
  transcript: { text: string; items: TranscriptItem[] };
  summary_metrics: SummaryMetrics;
  // Not part of the /review response. The demo adds the analysis artifact
  // (GET /recordings/{id}/artifacts/analysis) here for filler and pause markers.
  analysis?: AnalysisMetrics;
  // null when Bedrock coaching is turned off or unavailable. Feedback made
  // before schema_version 2 has only the `feedback` summary string.
  feedback: {
    feedback: string;
    schema_version?: number;
    categories?: Partial<Record<"general" | "pace" | "fillers" | "pauses", FeedbackCategory>>;
    moments?: FeedbackMoment[];
    metrics?: SummaryMetrics;
  } | null;
};
