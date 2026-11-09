// Shapes of the fake API responses in data/. The real API returns the same
// fields; see docs/aws-payload-api.md.

export type Project = {
  project_id: string;
  project_title: string;
  description: string;
  created_at: string;
};

export type SummaryMetrics = {
  duration_seconds: number;
  words_per_minute: number;
  fillers_per_100_words: number;
  pauses_per_speaking_minute: number;
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
  status: string;
  summary_metrics?: SummaryMetrics;
  failure_reason?: string;
};

// A recording plus its attempt number within its project, counting from 1.
export type Take = Recording & { take: number };

export type TimeSpan = { start_seconds: number; end_seconds: number };

export type AnalysisMetrics = SummaryMetrics & {
  filler_occurrences: (TimeSpan & { filler: string })[];
  pauses: TimeSpan[];
  long_pauses: TimeSpan[];
};

export type TranscriptItem = {
  type: string;
  start_time?: string;
  end_time?: string;
  alternatives: { content: string }[];
};
