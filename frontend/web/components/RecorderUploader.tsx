"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/Button";

export type RecorderStatus = "idle" | "recording" | "ready";

type RecorderUploaderProps = {
  maxAudioBytes: number;
  maxAudioDurationSeconds: number;
  onSubmit: (blob: Blob, filename: string) => void;
  submitLabel?: string;
  /** Lets the page react (for example the mascot) as recording starts and audio is ready. */
  onStatusChange?: (status: RecorderStatus) => void;
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

// How many recent level readings the meter shows, and how often it reads.
const METER_BARS = 48;
const METER_INTERVAL_MS = 80;
const silence = () => Array<number>(METER_BARS).fill(0);

function extensionFor(file: File | Blob) {
  if (file.type.includes("webm")) return "webm";
  if (file.type.includes("mp4")) return "m4a";
  if (file.type.includes("mpeg") || file.type.includes("mp3")) return "mp3";
  return "wav";
}

export function RecorderUploader({
  maxAudioBytes,
  maxAudioDurationSeconds,
  onSubmit,
  submitLabel = "Analyze demo recording",
  onStatusChange,
}: RecorderUploaderProps) {
  const [selected, setSelected] = useState<File | Blob | null>(null);
  const [filename, setFilename] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  // Live microphone level. Only ever filled from the real audio stream.
  const [levels, setLevels] = useState<number[]>(silence);
  const [metering, setMetering] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsed(seconds);
      if (seconds >= maxAudioDurationSeconds) recorderRef.current?.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [maxAudioDurationSeconds, recording]);

  const status: RecorderStatus = recording ? "recording" : selected ? "ready" : "idle";
  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  useEffect(() => {
    const analyser = analyserRef.current;
    if (!recording || !analyser) return;
    const samples = new Uint8Array(analyser.fftSize);
    const timer = window.setInterval(() => {
      // Stopping clears the meter straight away; a reading that lands just after must not redraw a bar.
      if (analyserRef.current !== analyser) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      const loudness = Math.min(1, Math.sqrt(sum / samples.length) * 4);
      setLevels((previous) => [...previous.slice(1), loudness]);
    }, METER_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [recording]);

  function stopMeter() {
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    analyserRef.current = null;
    setMetering(false);
    setLevels(silence());
  }

  useEffect(() => () => {
    void audioContextRef.current?.close().catch(() => undefined);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  function selectAudio(audio: File | Blob, name: string) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(audio);
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setSelected(audio);
    setFilename(name);
    setElapsed(0);
  }

  function validate(blob: Blob) {
    if (blob.size > maxAudioBytes) {
      setError(`That file is too large. Choose audio under ${Math.round(maxAudioBytes / 1024 / 1024)} MB.`);
      return false;
    }
    return true;
  }

  function chooseFile(file: File | null) {
    setError(null);
    if (!file) return;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setSelected(null);
    setFilename("");
    if (!/^audio\/(wav|x-wav|mpeg|mp3|mp4|webm|ogg)$/.test(file.type) &&
        !/\.(wav|mp3|m4a|webm)$/i.test(file.name)) {
      setError("Choose a WAV, MP3, M4A, or WebM audio file.");
      return;
    }
    if (!validate(file)) return;
    selectAudio(file, file.name);
  }

  async function startRecording() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("This browser does not support microphone recording. Upload an audio file instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        stopMeter();
        setRecording(false);
        if (validate(blob)) {
          selectAudio(blob, `speakup-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${extensionFor(blob)}`);
        }
      };
      // The meter is optional: recording works the same in browsers without Web Audio.
      const AudioContextClass = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        try {
          const context = new AudioContextClass();
          const analyser = context.createAnalyser();
          analyser.fftSize = 1024;
          context.createMediaStreamSource(stream).connect(analyser);
          audioContextRef.current = context;
          analyserRef.current = analyser;
          setMetering(true);
        } catch {
          audioContextRef.current = null;
          analyserRef.current = null;
        }
      }
      startedAtRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
      recorder.start();
    } catch {
      setError("Microphone access was unavailable. Check the browser permission or upload a file instead.");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function clearSelection() {
    if (recording) stopRecording();
    setSelected(null);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setFilename("");
    setElapsed(0);
    setError(null);
  }

  const maxMinutes = Math.round(maxAudioDurationSeconds / 60);
  const maxMegabytes = Math.round(maxAudioBytes / 1024 / 1024);
  const hint = "text-sm text-muted on-dark:text-cream/80";

  return (
    <section className="flex w-full flex-col gap-5" aria-label="Demo recording upload">
      {/* Each control sits with the limits that apply to it. */}
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <div className="flex flex-col items-start gap-2">
          <button type="button" className={buttonClass("accent")} onClick={recording ? stopRecording : startRecording}>
            {recording ? "■ Stop recording" : "● Record audio"}
          </button>
          <p className={hint}>Uses your microphone. Recording stops after {maxMinutes} {maxMinutes === 1 ? "minute" : "minutes"}.</p>
        </div>
        <div className="flex flex-col items-start gap-2">
          <label className={buttonClass("secondary")}>
            ↑ Upload audio
            <input
              type="file"
              accept=".wav,.mp3,.m4a,.webm,audio/*"
              className="sr-only"
              disabled={recording}
              onChange={(event) => {
                chooseFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
          </label>
          <p className={hint}>WAV, MP3, M4A or WebM, up to {maxMegabytes} MB.</p>
        </div>
      </div>

      {/* The meter is flat until a real microphone stream feeds it. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex h-12 items-center gap-[3px]" aria-hidden="true">
          {levels.map((level, index) => (
            <span
              key={index}
              className={`min-h-1 flex-1 rounded-full ${metering ? "bg-teal on-dark:bg-mint" : "bg-line on-dark:bg-night-line"}`}
              style={{ height: `${Math.round(level * 100)}%` }}
            />
          ))}
        </div>
        <p className={hint}>{metering ? "Live level from your microphone." : "The level meter moves while you record."}</p>
      </div>

      <p className="flex items-center gap-2 font-mono text-sm text-teal on-dark:text-mint" aria-live="polite">
        {recording && <span aria-hidden="true" className="recording-dot size-2.5 shrink-0 rounded-full bg-[#ff6b5e]" />}
        <span>{recording ? `RECORDING ${formatDuration(elapsed)} / ${formatDuration(maxAudioDurationSeconds)}` : selected ? `READY · ${filename}` : "DEMO ONLY · Nothing is sent to AWS"}</span>
      </p>
      {error && <p className="text-sm font-semibold text-rust on-dark:text-peach" role="alert">{error}</p>}
      {previewUrl && <audio controls src={previewUrl} className="w-full" aria-label="Preview selected audio" />}
      {selected && (
        <div className="flex flex-wrap gap-4">
          <button type="button" className={buttonClass("primary")} onClick={() => onSubmit(selected, filename)}>
            {submitLabel}
          </button>
          <button type="button" className={buttonClass("secondary")} onClick={clearSelection}>
            Discard
          </button>
        </div>
      )}
    </section>
  );
}
