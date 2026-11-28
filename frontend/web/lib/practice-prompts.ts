// Warm-up topics for the 2-minute practice speech. Each one is open ended on
// purpose: anyone can talk about it without notes or research. The bullets are
// things to cover, not a script, so people speak in their own words instead of
// reading a passage aloud.

export type PracticePrompt = {
  id: string;
  title: string;
  intro: string;
  points: string[];
};

// Two minutes is long enough to score pace, fillers and pauses, and short
// enough that a newcomer will try it.
export const PRACTICE_SECONDS = 120;

export const PRACTICE_PROMPTS: PracticePrompt[] = [
  {
    id: "place",
    title: "A place you love",
    intro: "Tell us about a place you would take a friend who has never been there.",
    points: ["Where it is and how you found it", "What it looks, sounds or smells like", "A moment you remember there", "Why someone else should go"],
  },
  {
    id: "skill",
    title: "Teach something small",
    intro: "Explain how to do something you are good at, for someone who has never tried it.",
    points: ["What it is and why it is worth learning", "The first two or three steps", "A mistake beginners make", "How they will know they got it right"],
  },
  {
    id: "change",
    title: "One thing you would change",
    intro: "Pick one thing about your school, job or city that you would change.",
    points: ["What it is like now", "Who it affects and how", "Your idea to fix it", "What would be different a year later"],
  },
  {
    id: "recommend",
    title: "Something worth trying",
    intro: "Recommend a book, show, game, food or habit to the people listening.",
    points: ["What it is in one sentence", "How you came across it", "The best part, with an example", "Who would like it and who would not"],
  },
  {
    id: "lesson",
    title: "A lesson you learned",
    intro: "Share a time something went differently than you planned.",
    points: ["What you expected to happen", "What actually happened", "What you did next", "What you would tell someone in the same spot"],
  },
  {
    id: "day",
    title: "Your ideal day",
    intro: "Walk us through a perfect ordinary day, from morning to night.",
    points: ["How it starts", "Who you spend it with", "The highlight", "Why this day and not a vacation"],
  },
];

export function getPrompt(id: string | null | undefined) {
  return PRACTICE_PROMPTS.find((prompt) => prompt.id === id);
}

// The next prompt in the list, wrapping around, so "Another topic" never shows the same one twice in a row.
export function nextPrompt(current: PracticePrompt) {
  const index = PRACTICE_PROMPTS.findIndex((prompt) => prompt.id === current.id);
  return PRACTICE_PROMPTS[(index + 1) % PRACTICE_PROMPTS.length];
}

export function promptDescription(prompt: PracticePrompt) {
  return `Practice speech: ${prompt.intro} Points: ${prompt.points.join("; ")}.`;
}
