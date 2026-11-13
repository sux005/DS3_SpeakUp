"use client";

// The transcript half of the "Listen back" area. Each sentence is one button:
// clicking it seeks to the sentence, and clicking a word inside it seeks to that
// word with a short lead-in. The sentence at the current playback time gets a
// slightly lighter background. Time comes from the audio player, so the
// highlight, the progress bar and the markers always agree.
//
// Follow mode: while on, the current sentence is kept in view as playback moves.
// Scrolling the transcript yourself turns it off, so it never fights you, and a
// "Resume following" button turns it back on. Clicking a sentence also resumes it.

import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { formatClock } from "@/lib/recordings";
import { activeSentenceIndex, placePauses, type Sentence } from "@/lib/transcript";
import type { FeedbackMoment, Pause } from "@/lib/types";

// Clicking a word starts playback this many seconds before it.
const WORD_LEAD_IN_SECONDS = 0.5;

type Filter = "all" | "fillers" | "pauses";

// Keep the current sentence about a third of the way down the transcript box.
const FOLLOW_OFFSET = 0.3;
// Fallback for browsers without the scrollend event.
const AUTO_SCROLL_MS = 700;
// Keys that scroll the transcript box when it has focus.
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export type SyncedTranscriptProps = {
  sentences: Sentence[];
  pauses: Pause[];
  moments?: FeedbackMoment[];
  currentTime: number;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
  // A new object asks to show the sentence at that time, e.g. after a marker click.
  revealRequest?: { seconds: number };
};

function pauseLabel(pause: Pause) {
  const seconds = pause.duration_seconds ?? pause.end_seconds - pause.start_seconds;
  return `${seconds.toFixed(1)} s`;
}

export function SyncedTranscript({ sentences, pauses, moments = [], currentTime, canSeek, onSeek, revealRequest }: SyncedTranscriptProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [following, setFollowing] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);
  const autoScrolling = useRef(false);
  const placement = useMemo(() => placePauses(sentences, pauses), [sentences, pauses]);
  const active = canSeek ? activeSentenceIndex(sentences, currentTime) : -1;
  const fillerCount = sentences.reduce((count, sentence) => count + sentence.words.filter((word) => word.filler).length, 0);
  const shown = sentences.filter((sentence) =>
    filter === "all" || sentence.tag === (filter === "fillers" ? "FILLER" : "PAUSE"));

  function scrollToSentence(index: number) {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-sentence-id="${sentences[index]?.id}"]`);
    if (!list || !row) return;
    const top = Math.max(0, row.offsetTop - list.clientHeight * FOLLOW_OFFSET);
    if (Math.abs(list.scrollTop - top) < 2) return;
    autoScrolling.current = true;
    const done = () => { autoScrolling.current = false; };
    list.addEventListener("scrollend", done, { once: true });
    window.setTimeout(done, AUTO_SCROLL_MS);
    list.scrollTo?.({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  useEffect(() => {
    if (following && active >= 0) scrollToSentence(active);
    // scrollToSentence only reads refs and props that are already dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, following, filter]);

  // A marker click shows its sentence even if the reader had scrolled away or
  // filtered it out, and turns following back on.
  const [handledReveal, setHandledReveal] = useState(revealRequest);
  if (revealRequest !== handledReveal) {
    setHandledReveal(revealRequest);
    if (revealRequest) {
      setFilter("all");
      setFollowing(true);
    }
  }
  useEffect(() => {
    if (!revealRequest) return;
    const index = activeSentenceIndex(sentences, revealRequest.seconds);
    if (index >= 0) window.requestAnimationFrame(() => scrollToSentence(index));
    // Runs once per request object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealRequest]);

  function stopFollowing() {
    if (!autoScrolling.current) setFollowing(false);
  }

  function seekFromSentence(event: MouseEvent<HTMLButtonElement>, sentence: Sentence) {
    setFollowing(true);
    const word = (event.target as HTMLElement).closest<HTMLElement>("[data-start]");
    const start = word ? Number(word.dataset.start) : NaN;
    onSeek(Number.isFinite(start) ? Math.max(sentence.start, start - WORD_LEAD_IN_SECONDS) : sentence.start);
  }

  const filters: [Filter, string][] = [["all", "All"], ["fillers", `Fillers (${fillerCount})`], ["pauses", "Pauses"]];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-xl font-bold text-cream">Transcript</h3>
        <div className="flex gap-1 font-mono text-[11px]" role="group" aria-label="Show sentences">
          {filters.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`min-h-8 cursor-pointer rounded-sm border px-2.5 uppercase ${
                filter === value ? "border-mint bg-mint text-night" : "border-night-line text-mint hover:border-mint"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
      <ol
        ref={listRef}
        className="relative max-h-[480px] overflow-y-auto overscroll-contain rounded-md border border-night-line"
        aria-label="Transcript sentences"
        onWheel={stopFollowing}
        onTouchMove={stopFollowing}
        onScroll={stopFollowing}
        onKeyDown={(event) => { if (SCROLL_KEYS.has(event.key) && event.target === event.currentTarget) stopFollowing(); }}
        tabIndex={0}
      >
        {shown.map((sentence) => {
          const index = sentences.indexOf(sentence);
          const isActive = index === active;
          const between = placement.afterSentence.get(sentence.id) ?? [];
          return (
            <Fragment key={sentence.id}>
              <li data-sentence-id={sentence.id}>
                <button
                  type="button"
                  disabled={!canSeek}
                  aria-current={isActive ? "true" : undefined}
                  onClick={(event) => seekFromSentence(event, sentence)}
                  className={`flex w-full cursor-pointer flex-col gap-1 px-4 py-3 text-left disabled:cursor-default sm:flex-row sm:gap-4 ${
                    isActive ? "bg-night-soft text-cream" : "text-mint hover:bg-night-soft/60"
                  }`}
                >
                  <span className="w-24 shrink-0 pt-1 font-mono text-[11px] text-peach">
                    {formatClock(sentence.start)}
                    {sentence.tag && ` · ${sentence.tag}`}
                  </span>
                  <span className="text-[17px] leading-relaxed">
                    {sentence.words.map((word, wordIndex) => {
                      const marked = moments.some((moment) => word.start >= moment.start_seconds && word.start <= moment.end_seconds);
                      const inside = placement.afterWord.get(`${sentence.id}:${wordIndex}`) ?? [];
                      return (
                        <Fragment key={wordIndex}>
                          <span
                            data-start={word.start}
                            className={`rounded-sm ${word.filler ? "bg-rose/15 px-0.5 font-semibold text-rose" : ""} ${
                              marked ? "underline decoration-mint decoration-2 underline-offset-4" : ""
                            }`}
                          >
                            {word.text}
                          </span>
                          {inside.map((pause) => (
                            <span
                              key={pause.start_seconds}
                              className={`mx-0.5 font-mono text-[13px] ${pause.inside_sentence === false ? "text-mint/80" : "font-bold text-peach"}`}
                              title={`${pause.inside_sentence === false ? "Natural pause" : "Pause inside sentence"}, ${pauseLabel(pause)}`}
                            >
                              <span aria-hidden="true">‖</span>
                              <span className="sr-only">
                                {` (${pause.inside_sentence === false ? "natural pause" : "pause inside sentence"}, ${pauseLabel(pause)})`}
                              </span>
                            </span>
                          ))}{" "}
                        </Fragment>
                      );
                    })}
                  </span>
                </button>
              </li>
              {filter === "all" && between.length > 0 && (
                <li className="px-4 py-1 font-mono text-[11px] text-mint/80 sm:pl-32">
                  {between.map((pause) => (
                    <span key={pause.start_seconds} className="mr-3">
                      {pause.inside_sentence === false
                        ? `· natural pause, ${pauseLabel(pause)}`
                        : `‖ pause inside sentence, ${pauseLabel(pause)}`}
                    </span>
                  ))}
                </li>
              )}
            </Fragment>
          );
        })}
        {shown.length === 0 && <li className="px-4 py-3 text-mint">Nothing to show for this filter.</li>}
      </ol>
      {canSeek && !following && (
        <button
          type="button"
          onClick={() => setFollowing(true)}
          className="absolute bottom-3 left-1/2 min-h-10 -translate-x-1/2 cursor-pointer rounded-full bg-mint px-4 font-mono text-[11px] font-semibold uppercase text-night shadow-lg"
        >
          ↓ Resume following
        </button>
      )}
      </div>
    </div>
  );
}
