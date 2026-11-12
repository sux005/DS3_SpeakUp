"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/Button";

type RecorderUploaderProps = {
  maxAudioBytes: number;
  maxAudioDurationSeconds: number;
  onSubmit: (blob: Blob, filename: string) => void;
  submitLabel?: string;
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

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

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsed(seconds);
      if (seconds >= maxAudioDurationSeconds) recorderRef.current?.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [maxAudioDurationSeconds, recording]);

  useEffect(() => () => {
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
        setRecording(false);
        if (validate(blob)) {
          selectAudio(blob, `speakup-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${extensionFor(blob)}`);
        }
      };
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

  return (
    <section className="flex w-full flex-col gap-5" aria-label="Demo recording upload">
      <div className="flex flex-wrap gap-4">
        <button type="button" className={buttonClass("accent")} onClick={recording ? stopRecording : startRecording}>
          {recording ? "■ Stop recording" : "● Record audio"}
        </button>
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
      </div>
      <p className="font-mono text-sm text-teal" aria-live="polite">
        {recording ? `RECORDING ${formatDuration(elapsed)} / ${formatDuration(maxAudioDurationSeconds)}` : selected ? `READY · ${filename}` : "DEMO ONLY · Nothing is sent to AWS"}
      </p>
      {error && <p className="text-sm text-rust" role="alert">{error}</p>}
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
