"use client";

import { useEffect, useRef, useState } from "react";

export type ReviewMoment = {
  id?: string;
  at: number;
  label: string;
  end?: number;
  text?: string;
  kind?: "strength" | "improve";
  observation?: string;
  nextStep?: string;
};

type AudioReviewPlayerProps = {
  audioUrl?: string;
  seekRequest?: { seconds: number };
  durationSeconds?: number;
  moments: ReviewMoment[];
  onTimeChange?: (seconds: number) => void;
  onMomentSelect?: (moment: ReviewMoment) => void;
};

function formatClock(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function AudioReviewPlayer({
  audioUrl,
  seekRequest,
  durationSeconds = 0,
  moments,
  onTimeChange,
  onMomentSelect,
}: AudioReviewPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => {
      setCurrentTime(audio.currentTime);
      onTimeChange?.(audio.currentTime);
    };
    const updateDuration = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    };
    const stopPlaying = () => setPlaying(false);
    const resetForNewSource = () => {
      setCurrentTime(0);
      setDuration(durationSeconds);
      setPlaying(false);
      setError(undefined);
    };
    const handleError = () => {
      setPlaying(false);
      setError("This recording could not be loaded.");
    };

    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadstart", resetForNewSource);
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("durationchange", updateDuration);
    audio.addEventListener("ended", stopPlaying);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadstart", resetForNewSource);
      audio.removeEventListener("loadedmetadata", updateDuration);
      audio.removeEventListener("durationchange", updateDuration);
      audio.removeEventListener("ended", stopPlaying);
      audio.removeEventListener("error", handleError);
      audio.pause();
    };
  }, [audioUrl, durationSeconds, onTimeChange]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl || !seekRequest) return;
    audio.currentTime = seekRequest.seconds;
    onTimeChange?.(seekRequest.seconds);
    audio.play().then(() => setPlaying(true)).catch(() => {
      setError("Playback was blocked. Press play again to retry.");
    });
  }, [seekRequest, audioUrl, onTimeChange]);

  const seek = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    const nextTime = Math.min(Math.max(seconds, 0), duration || seconds);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
    onTimeChange?.(nextTime);
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    setError(undefined);
    if (audio.paused) {
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
        setError("Playback was blocked. Press play again to retry.");
      }
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const unavailable = !audioUrl;
  const max = Math.max(duration, 0);

  return (
    <div className="flex w-full flex-col gap-4" aria-label="Audio review player">
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" />}
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="inline-flex min-h-11 min-w-24 items-center justify-center rounded-md border border-peach bg-peach px-5 text-sm font-semibold text-night transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={togglePlayback}
          disabled={unavailable}
          aria-label={playing ? "Pause recording" : "Play recording"}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span className="font-mono text-sm text-mint" aria-live="polite">
          {formatClock(currentTime)} / {formatClock(max)}
        </span>
        {unavailable && <span className="text-sm text-mint">Audio preview unavailable in demo data.</span>}
      </div>
      <input
        type="range"
        min={0}
        max={max || 1}
        step={0.01}
        value={Math.min(currentTime, max || 1)}
        onChange={(event) => seek(Number(event.target.value))}
        disabled={unavailable || !max}
        aria-label="Recording position"
        className="w-full accent-peach disabled:opacity-50"
      />
      {error && <p className="text-sm text-peach" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2" aria-label="Recording moments">
        {moments.map((moment, index) => (
          <button
            type="button"
            key={`${moment.label}-${moment.at}-${index}`}
            className="rounded border border-night-line px-3 py-2 font-mono text-[11px] text-mint transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              seek(moment.at);
              onMomentSelect?.(moment);
            }}
            disabled={unavailable && !moment.observation}
          >
            {formatClock(moment.at)} · {moment.label}
          </button>
        ))}
      </div>
    </div>
  );
}
