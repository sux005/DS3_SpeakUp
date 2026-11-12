// A copy of src/scoring/rubrics/speaking-2026-10-31.csv, the rubric the
// backend scores with. If that CSV changes, update this file to match.
// See docs/rubric-csv-format.md.

export type MetricKey = "speaking_rate" | "filler_words" | "pauses_inside_sentences";

export type Band = { score: number; range: string };

export type RubricMetric = {
  key: MetricKey;
  title: string;
  unit: string;
  measures: string;
  // Best score first.
  bands: Band[];
  // One coaching tip per score, index = score (0 to 4).
  tips: [string, string, string, string, string];
};

export const rubricVersion = "2026-10-31";
export const minimumSpeakingSeconds = 60;

export const rubric: RubricMetric[] = [
  {
    key: "speaking_rate",
    title: "Speaking rate",
    unit: "words per minute (WPM)",
    measures: "How many words you say per minute of speaking, not counting pauses.",
    bands: [
      { score: 4, range: "135–155 WPM" },
      { score: 3, range: "120–135 or 155–170 WPM" },
      { score: 2, range: "105–120 or 170–185 WPM" },
      { score: 1, range: "90–105 or 185–200 WPM" },
      { score: 0, range: "Under 90 or over 200 WPM" },
    ],
    tips: [
      "Your pace is far from the target. Mark two spots in your script to check your speed, and practise one minute at a time.",
      "Your pace is well off the target. Practise with a timer and aim for about 145 words in one minute.",
      "Your pace is noticeably off. Try reading one paragraph aloud against a timer and adjust.",
      "You're close to the target pace. Small adjustments on your longest sections will get you there.",
      "Your pace is right in the target range. Keep it steady as the talk goes on.",
    ],
  },
  {
    key: "filler_words",
    title: "Filler words",
    unit: "fillers per 100 words",
    measures: "How often you say um, uh, er and similar fillers, per 100 words spoken.",
    bands: [
      { score: 4, range: "Fewer than 2" },
      { score: 3, range: "2 to under 3.5" },
      { score: 2, range: "3.5 to under 5.5" },
      { score: 1, range: "5.5 to under 8" },
      { score: 0, range: "8 or more" },
    ],
    tips: [
      "Fillers are frequent. Click the red words in the transcript to hear where they happen, then try a silent pause there instead.",
      "Fillers come up often. Notice whether they cluster at the start of sentences, and pause before you start speaking.",
      "Some fillers. Pick the spot with the most red words and practise just that part.",
      "A few fillers. Replace the remaining ones with a short pause.",
      "Very few fillers. Nice work.",
    ],
  },
  {
    key: "pauses_inside_sentences",
    title: "Pauses inside sentences",
    unit: "pauses per speaking-minute",
    measures: "How often you stop in the middle of a sentence, per minute of speaking.",
    bands: [
      { score: 4, range: "Fewer than 9" },
      { score: 3, range: "9 to under 12" },
      { score: 2, range: "12 to under 15" },
      { score: 1, range: "15 to under 18" },
      { score: 0, range: "18 or more" },
    ],
    tips: [
      "Many mid-sentence stops. Rehearse the hardest sections until each sentence comes out in one go.",
      "Frequent mid-sentence stops. Shorter sentences in your script can help.",
      "Some mid-sentence stops. Save pauses for the ends of sentences, where they help the listener.",
      "Mostly smooth sentences. Check the few places you stopped mid-thought.",
      "Your sentences flow without breaking up. Keep pausing between them, not inside them.",
    ],
  },
];
