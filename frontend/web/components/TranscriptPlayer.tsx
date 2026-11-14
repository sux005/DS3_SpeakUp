"use client";

// Runs in the browser (not on the server) because it reacts to clicks and to
// the audio playing. Holds the audio player and the transcript together so
// clicking a word can move the audio, and the audio can highlight the word.

import { useRef, useState, type ReactNode } from "react";
import { formatClock } from "@/lib/recordings";
import type { Sentence } from "@/lib/transcript";

// Clicking a word starts the audio this many seconds before it.
const LEAD_IN_SECONDS = 0.5;

type Filter = "all" | "fillers" | "pauses";

export function TranscriptPlayer({
  audioSrc,
  sentences,
  moments,
  coaching,
}: {
  audioSrc: string;
  sentences: Sentence[];
  moments: { at: number; label: string }[];
  coaching: ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [missingAudio, setMissingAudio] = useState(false);

  function jumpTo(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, seconds - LEAD_IN_SECONDS);
    audio.play().catch(() => {});
  }

  const shown = sentences.filter(
    (s) =>
      filter === "all" ||
      (filter === "fillers" && s.tag === "FILLER") ||
      (filter === "pauses" && s.tag === "PAUSE"),
  );
  const fillerCount = sentences.reduce((n, s) => n + s.words.filter((w) => w.filler).length, 0);

  return (
    <>
      <section className="flex w-full flex-col gap-3.5 bg-night p-6">
        <p className="font-mono text-[11px] text-mint">LISTEN BACK · CLICK ANY WORD TO JUMP TO IT</p>
        <audio
          ref={audioRef}
          src={audioSrc}
          controls
          preload="metadata"
          className="w-full"
          onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
          onError={() => setMissingAudio(true)}
        />
        {missingAudio && (
          <p className="text-sm text-peach">
            No audio file found at {audioSrc}. See &quot;Demo audio&quot; in frontend/web/README.md.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {moments.map((moment, index) => (
            <button
              key={`${moment.label}-${index}`}
              type="button"
              onClick={() => jumpTo(moment.at)}
              className={`cursor-pointer rounded-sm px-2 py-1 font-mono text-[11px] hover:opacity-80 ${
                moment.label === "filler" ? "bg-red-700 text-cream" : "bg-peach text-night"
              }`}
            >
              {formatClock(moment.at)} · {moment.label}
            </button>
          ))}
        </div>
      </section>

      <div className="flex w-full flex-col gap-10 md:flex-row md:items-start">
        <section className="flex min-w-0 flex-1 flex-col gap-4">
          <h2 className="font-display text-2xl font-bold text-ink">Transcript</h2>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            {(
              [
                ["all", "ALL"],
                ["fillers", `FILLERS (${fillerCount})`],
                ["pauses", "PAUSES"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className={`cursor-pointer rounded-sm border px-3 py-1.5 ${
                  filter === key ? "border-teal bg-teal text-cream" : "border-line text-teal"
                }`}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-1.5 text-muted">
              <span className="inline-block size-3 rounded-sm bg-red-100 ring-1 ring-red-600" />
              FILLER WORD
            </span>
          </div>

          <ul className="max-h-[560px] overflow-y-auto border-y border-line pr-2">
            {shown.map((sentence) => {
              const playing = now >= sentence.start && now <= sentence.end + 0.3;
              return (
                <li
                  key={sentence.id}
                  className={`flex flex-col gap-1 border-t border-line py-4 first:border-t-0 sm:flex-row sm:gap-5 ${
                    playing ? "bg-pale" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => jumpTo(sentence.start)}
                    className="w-28 shrink-0 cursor-pointer text-left font-mono text-[11px] text-rust hover:underline"
                  >
                    {formatClock(sentence.start)}
                    {sentence.tag && ` · ${sentence.tag}`}
                  </button>
                  <p className="text-[17px] leading-relaxed text-ink">
                    {sentence.words.map((word, index) => {
                      const current = now >= word.start && now < word.end + 0.15;
                      return (
                        <span key={index}>
                          <button
                            type="button"
                            onClick={() => jumpTo(word.start)}
                            title={`Jump to ${formatClock(word.start)}`}
                            className={`cursor-pointer rounded-sm px-0.5 hover:bg-mint/50 ${
                              word.filler ? "bg-red-100 font-semibold text-red-700" : ""
                            } ${current ? "bg-mint text-night" : ""}`}
                          >
                            {word.text}
                          </button>{" "}
                        </span>
                      );
                    })}
                  </p>
                </li>
              );
            })}
            {shown.length === 0 && <li className="py-4 text-muted">Nothing to show for this filter.</li>}
          </ul>
        </section>

        <aside className="flex w-full flex-col gap-4 md:w-[440px]">{coaching}</aside>
      </div>
    </>
  );
}
