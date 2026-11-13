"use client";

// Playback controls with timestamped markers on the timeline. The <audio>
// element's currentTime is the one playback clock: the time display, the
// progress bar, the markers and (through onTimeChange) the transcript all read it.

import { useEffect, useMemo, useRef, useState } from "react";
import { clusterMoments, momentKindLabels, nextMoment, type MomentCluster, type MomentKind, type ReviewMoment } from "@/lib/markers";

export type { ReviewMoment } from "@/lib/markers";

// Marker colours, shared with the legend and the transcript highlights.
const kindColour: Record<MomentKind, string> = {
  filler: "bg-rose",
  pause: "bg-peach",
  improve: "bg-mint",
  strength: "bg-mint",
};
// Used before the track has been measured (and in tests, which have no layout).
const FALLBACK_TRACK_WIDTH = 640;

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
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setTrackWidth(entry.contentRect.width));
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

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
  // Without a known length (no audio yet), size the timeline to the last moment
  // so coaching moments stay selectable.
  const timelineLength = max > 0 ? max : Math.max(0, ...moments.map((moment) => moment.end ?? moment.at)) + 1;
  const clusters = useMemo(
    () => clusterMoments(moments, timelineLength, trackWidth || FALLBACK_TRACK_WIDTH),
    [moments, timelineLength, trackWidth],
  );
  const kinds = new Set(moments.map((moment) => moment.kind ?? "improve"));
  const previous = nextMoment(moments, currentTime, -1);
  const next = nextMoment(moments, currentTime, 1);

  const selectMoment = (moment: ReviewMoment) => {
    if (!unavailable) {
      seek(moment.at);
      const audio = audioRef.current;
      audio?.play().then(() => setPlaying(true)).catch(() => {
        setError("Playback was blocked. Press play again to retry.");
      });
    }
    onMomentSelect?.(moment);
  };

  const clusterLabel = (cluster: MomentCluster) => {
    const [first] = cluster.moments;
    const describe = (moment: ReviewMoment) => `${moment.label}${moment.text ? ` · ${moment.text}` : ""}`;
    if (cluster.moments.length === 1) return `${formatClock(first.at)} · ${describe(first)}`;
    return `${formatClock(first.at)} · ${cluster.moments.length} moments: ${cluster.moments.map(describe).join(", ")}`;
  };

  const isNow = (cluster: MomentCluster) => !unavailable && cluster.moments.some((moment) =>
    currentTime >= moment.at - 0.3 && currentTime <= (moment.end ?? moment.at) + 0.3);

  return (
    <div className="flex w-full flex-col gap-4" aria-label="Audio review player">
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" />}
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="press inline-flex min-h-11 min-w-24 cursor-pointer items-center justify-center rounded-md border border-peach bg-peach px-5 text-sm font-semibold text-night hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
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
      <div className="flex flex-col gap-1">
        {/* Inset by half the slider thumb so markers line up with thumb positions. */}
        <div ref={trackRef} className="relative mx-2 h-8" role="group" aria-label="Recording moments">
          {clusters.map((cluster) => {
            const [first] = cluster.moments;
            const count = cluster.moments.length;
            const now = isNow(cluster);
            return (
              <button
                type="button"
                key={`${first.id ?? first.label}-${first.at}`}
                style={{ left: `${cluster.percent}%` }}
                className="marker absolute bottom-0 flex h-8 w-6 -translate-x-1/2 cursor-pointer items-end justify-center rounded-sm disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => selectMoment(first)}
                disabled={unavailable && !cluster.moments.some((moment) => moment.observation)}
                aria-label={clusterLabel(cluster)}
                title={clusterLabel(cluster)}
              >
                {count > 1 && (
                  <span aria-hidden="true" className="absolute top-0 font-mono text-[10px] leading-none text-cream">{count}</span>
                )}
                <span
                  aria-hidden="true"
                  data-now={now}
                  className={`marker-bar block w-1.5 rounded-full ${kindColour[first.kind ?? "improve"]} ${count > 1 ? "h-4" : "h-3"} ${
                    now ? "ring-2 ring-cream" : ""
                  }`}
                />
              </button>
            );
          })}
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
      </div>
      {error && <p className="text-sm text-peach" role="alert">{error}</p>}
      {moments.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-mint" aria-label="Marker legend">
            {(["filler", "pause", "improve"] as const)
              .filter((kind) => kinds.has(kind) || (kind === "improve" && kinds.has("strength")))
              .map((kind) => (
                <li key={kind} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={`inline-block h-3 w-1.5 rounded-full ${kindColour[kind]}`} />
                  {kind === "improve" ? "Coaching moment" : momentKindLabels[kind]}
                </li>
              ))}
          </ul>
          <div className="flex gap-2">
            {([["Previous moment", "← Previous", previous], ["Next moment", "Next →", next]] as const).map(([label, text, target]) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                disabled={unavailable || !target}
                onClick={() => target && selectMoment(target)}
                className="press min-h-9 cursor-pointer rounded-sm border border-night-line px-3 font-mono text-[11px] text-mint hover:border-mint disabled:cursor-not-allowed disabled:opacity-40"
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
