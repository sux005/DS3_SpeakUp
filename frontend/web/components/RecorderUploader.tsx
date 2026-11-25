"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/Button";
import { liveFeedback } from "@/lib/live-feedback";

export type RecorderStatus = "idle" | "countdown" | "recording" | "paused" | "ready";

type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechRecognitionSession = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionBrowser = Window & {
  SpeechRecognition?: new () => SpeechRecognitionSession;
  webkitSpeechRecognition?: new () => SpeechRecognitionSession;
};
type PaceSample = { second: number; wpm: number };

type RecorderUploaderProps = {
  maxAudioBytes: number;
  maxAudioDurationSeconds: number;
  onSubmit: (blob: Blob, filename: string) => Promise<string | void> | string | void;
  submitLabel?: string;
  /** Lets the page react (for example the mascot) as recording starts and audio is ready. */
  onStatusChange?: (status: RecorderStatus) => void;
  disabled?: boolean;
  live?: boolean;
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

// How many recent level readings the meter shows, and how often it reads.
const METER_BARS = 48;
const METER_INTERVAL_MS = 80;
const SKIP_RECORD_AGAIN_CONFIRMATION = "speakup-skip-record-again-confirmation";
const silence = () => Array<number>(METER_BARS).fill(0);
const joinTranscript = (left: string, right: string) => [left.trim(), right.trim()].filter(Boolean).join(" ");

function PaceTrend({ samples }: { samples: PaceSample[] }) {
  if (samples.length === 0) {
    return null;
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const x = (second: number) => first.second === last.second ? 300 : ((second - first.second) / (last.second - first.second)) * 600;
  const y = (wpm: number) => 84 - ((Math.max(100, Math.min(180, wpm)) - 100) / 80) * 68;

  return (
    <div className="mt-4 border-t border-night-line pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-xs uppercase text-mint">Pace trend</p>
        </div>
        <span className="font-mono text-xs text-mint">{formatDuration(first.second)}–{formatDuration(last.second)}</span>
      </div>
      <div className="mt-3 rounded-lg border border-night-line bg-night/20 p-3">
        <svg className="block h-24 w-full" viewBox="0 0 600 100" preserveAspectRatio="none" role="img" aria-label={samples.length === 1 ? `Pace trend started at ${first.wpm} words per minute, with a target of 135 to 155` : `Pace trend from ${first.wpm} to ${last.wpm} words per minute, with a target of 135 to 155`}>
          <rect x="0" y={y(155)} width="600" height={y(135) - y(155)} className="fill-mint/15" />
          <line x1="0" x2="600" y1={y(155)} y2={y(155)} className="stroke-mint/45" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
          <line x1="0" x2="600" y1={y(135)} y2={y(135)} className="stroke-mint/45" strokeDasharray="4 5" vectorEffect="non-scaling-stroke" />
          {samples.length === 1 && <line x1="294" x2="306" y1={y(first.wpm)} y2={y(first.wpm)} strokeWidth="5" strokeLinecap="round" vectorEffect="non-scaling-stroke" className={first.wpm < 135 ? "stroke-peach" : first.wpm > 155 ? "stroke-rose" : "stroke-mint"} />}
          {samples.slice(1).map((sample, index) => {
            const previous = samples[index];
            return <line key={sample.second} x1={x(previous.second)} y1={y(previous.wpm)} x2={x(sample.second)} y2={y(sample.wpm)} strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" className={sample.wpm < 135 ? "stroke-peach" : sample.wpm > 155 ? "stroke-rose" : "stroke-mint"} />;
          })}
        </svg>
        <div className="mt-1 flex justify-between font-mono text-xs text-mint/80" aria-hidden="true"><span>{formatDuration(first.second)}</span><span>Time →</span><span>{formatDuration(last.second)}</span></div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mint"><span><span className="mr-1 text-peach">●</span>Below</span><span><span className="mr-1 text-mint">●</span>Target</span><span><span className="mr-1 text-rose">●</span>Above</span></div>
    </div>
  );
}

function extensionFor(file: File | Blob) {
  if (file.type.includes("webm")) return "webm";
  if (file.type.includes("mp4")) return "m4a";
  if (file.type.includes("mpeg") || file.type.includes("mp3")) return "mp3";
  return "wav";
}

function recordingStartMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone permission was denied. Allow access in your browser and try again.";
  if (name === "NotReadableError" || name === "AbortError") return "The microphone is unavailable or in use. Check your input device and try again.";
  if (name === "InvalidStateError") return "The microphone disconnected before recording began. Check your input device and try again.";
  if (name === "NotSupportedError") return "This browser could not start audio recording. Try another browser or upload a file.";
  return "Recording could not start. Check your microphone and try again, or upload a file.";
}

export function RecorderUploader({
  maxAudioBytes,
  maxAudioDurationSeconds,
  onSubmit,
  submitLabel = "Analyze demo recording",
  onStatusChange,
  disabled = false,
  live = false,
}: RecorderUploaderProps) {
  const [selected, setSelected] = useState<File | Blob | null>(null);
  const [filename, setFilename] = useState("");
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [resuming, setResuming] = useState(false);
  const [confirmRecordAgain, setConfirmRecordAgain] = useState(false);
  const [doNotShowAgain, setDoNotShowAgain] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [paceHistory, setPaceHistory] = useState<PaceSample[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const previewUrlRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);
  const totalPausedMsRef = useRef(0);
  // Live microphone level. Only ever filled from the real audio stream.
  const [levels, setLevels] = useState<number[]>(silence);
  const [metering, setMetering] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const transcriptRef = useRef("");
  const [transcriptNotice, setTranscriptNotice] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionSession | null>(null);
  const recordingActiveRef = useRef(false);
  const sessionBaseRef = useRef("");
  const latestFinalRef = useRef("");
  const restartTimerRef = useRef<number | null>(null);
  const transcriptionEnabledRef = useRef(false);
  const countdownTimerRef = useRef<number | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const confirmationDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = confirmationDialogRef.current;
    if (!confirmRecordAgain || !dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [confirmRecordAgain]);

  useEffect(() => {
    if (!recording || paused) return;
    const timer = window.setInterval(() => {
      const seconds = activeSeconds();
      setElapsed(seconds);
      recordPaceSample(seconds, transcriptRef.current);
      if (seconds >= maxAudioDurationSeconds) recorderRef.current?.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [maxAudioDurationSeconds, recording, paused]);

  const status: RecorderStatus = recording ? paused ? "paused" : "recording" : preparing || countdown !== null ? "countdown" : selected ? "ready" : "idle";
  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  useEffect(() => {
    const analyser = analyserRef.current;
    if (!recording || paused || !analyser) return;
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
  }, [recording, paused]);

  function activeSeconds() {
    return Math.floor(((pausedAtRef.current ?? Date.now()) - startedAtRef.current - totalPausedMsRef.current) / 1000);
  }

  function stopMeter() {
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    analyserRef.current = null;
    setMetering(false);
    setLevels(silence());
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingRef.current = false;
      if (countdownTimerRef.current !== null) window.clearTimeout(countdownTimerRef.current);
      recordingActiveRef.current = false;
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      try { recognitionRef.current?.stop(); } catch { /* Recognition may already have ended. */ }
      void audioContextRef.current?.close().catch(() => undefined);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function clearTranscript() {
    recognitionRef.current = null;
    transcriptRef.current = "";
    setFinalTranscript("");
    setInterimTranscript("");
    setTranscriptNotice(null);
    setPaceHistory([]);
    sessionBaseRef.current = "";
    latestFinalRef.current = "";
  }

  function recordPaceSample(second: number, transcript: string) {
    const wpm = liveFeedback(transcript, second).pace;
    if (wpm === null) return;
    setPaceHistory((previous) => {
      const last = previous.at(-1);
      if (last?.second === second && last.wpm === wpm) return previous;
      const sample = { second, wpm };
      return last?.second === second ? [...previous.slice(0, -1), sample] : [...previous, sample];
    });
  }

  function stopTranscription() {
    recordingActiveRef.current = false;
    transcriptionEnabledRef.current = false;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
    try { recognitionRef.current?.stop(); } catch { /* Recognition may already have ended. */ }
  }

  function startTranscription() {
    const browser = window as SpeechRecognitionBrowser;
    const SpeechRecognitionClass = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      setTranscriptNotice("Live transcription is not supported in this browser. Recording still works.");
      return;
    }
    let recognition: SpeechRecognitionSession;
    try {
      recognition = new SpeechRecognitionClass();
    } catch {
      setTranscriptNotice("Live transcription is unavailable. Your audio is still recording.");
      return;
    }
    recognitionRef.current = recognition;
    transcriptionEnabledRef.current = true;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return;
      const finalParts: string[] = [];
      const interimParts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        (result.isFinal ? finalParts : interimParts).push(result[0].transcript);
      }
      const finalText = joinTranscript(sessionBaseRef.current, finalParts.join(" "));
      latestFinalRef.current = finalText;
      setFinalTranscript(finalText);
      const interimText = interimParts.join(" ").trim();
      setInterimTranscript(interimText);
      transcriptRef.current = joinTranscript(finalText, interimText);
      recordPaceSample(activeSeconds(), transcriptRef.current);
    };
    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return;
      if (!recordingActiveRef.current || event.error === "no-speech" || event.error === "aborted") return;
      transcriptionEnabledRef.current = false;
      setTranscriptNotice("Live transcription stopped. Your audio is still recording and can be analyzed after you submit it.");
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      sessionBaseRef.current = latestFinalRef.current;
      setInterimTranscript("");
      transcriptRef.current = latestFinalRef.current;
      recordPaceSample(activeSeconds(), transcriptRef.current);
      if (!recordingActiveRef.current || !transcriptionEnabledRef.current) return;
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        if (!recordingActiveRef.current || !transcriptionEnabledRef.current) return;
        try {
          recognition.start();
        } catch {
          transcriptionEnabledRef.current = false;
          setTranscriptNotice("Live transcription stopped. Your audio is still recording and can be analyzed after you submit it.");
        }
      }, 300);
    };
    try {
      recognition.start();
    } catch {
      transcriptionEnabledRef.current = false;
      setTranscriptNotice("Live transcription is unavailable. Your audio is still recording.");
    }
  }

  function selectAudio(audio: File | Blob, name: string, keepTranscript = false) {
    if (!keepTranscript) clearTranscript();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(audio);
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setSelected(audio);
    setFilename(name);
    if (!keepTranscript) setElapsed(0);
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
    clearTranscript();
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

  function createRecorder(stream: MediaStream, mimeType?: string) {
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data);
    recorder.onstop = () => {
      if (countdownTimerRef.current !== null) window.clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = null;
      pendingRef.current = false;
      setCountdown(null);
      setResuming(false);
      stopTranscription();
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      stopMeter();
      setRecording(false);
      setPaused(false);
      pausedAtRef.current = null;
      if (validate(blob)) {
        selectAudio(blob, `speakup-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${extensionFor(blob)}`, true);
      }
    };
    return recorder;
  }

  function startMeter(stream: MediaStream) {
    const AudioContextClass = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
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

  async function startRecording() {
    if (pendingRef.current || recording) return;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("This browser does not support microphone recording. Upload an audio file instead.");
      return;
    }
    pendingRef.current = true;
    setPreparing(true);
    let microphoneReady = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneReady = true;
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      streamRef.current = stream;
      let chosenMimeType = mimeType;
      let recorder: MediaRecorder;
      try {
        recorder = createRecorder(stream, chosenMimeType);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotSupportedError" && mimeType)) throw error;
        chosenMimeType = undefined;
        recorder = createRecorder(stream);
      }
      setPreparing(false);
      setCountdown(3);
      const tick = (remaining: number) => {
        countdownTimerRef.current = window.setTimeout(() => {
          if (!pendingRef.current || !mountedRef.current) return;
          if (remaining > 1) {
            setCountdown(remaining - 1);
            tick(remaining - 1);
            return;
          }
          countdownTimerRef.current = null;
          setCountdown(null);
          let startError: unknown = null;
          try {
            recorder.start();
          } catch (error) {
            startError = error;
            if (error instanceof DOMException && error.name === "NotSupportedError" && chosenMimeType) {
              try {
                createRecorder(stream).start();
                startError = null;
              } catch (fallbackError) {
                startError = fallbackError;
              }
            }
          }
          if (startError) {
            stream.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
            recorderRef.current = null;
            pendingRef.current = false;
            stopMeter();
            setError(recordingStartMessage(startError));
            return;
          }
          startedAtRef.current = Date.now();
          pausedAtRef.current = null;
          totalPausedMsRef.current = 0;
          setElapsed(0);
          setPaused(false);
          if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
          previewUrlRef.current = null;
          setPreviewUrl(null);
          setSelected(null);
          setFilename("");
          clearTranscript();
          startMeter(stream);
          recordingActiveRef.current = true;
          pendingRef.current = false;
          setRecording(true);
          startTranscription();
        }, 1000);
      };
      tick(3);
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      stopMeter();
      pendingRef.current = false;
      setPreparing(false);
      setCountdown(null);
      setRecording(false);
      setError(error instanceof DOMException || microphoneReady
        ? recordingStartMessage(error)
        : "Microphone access was unavailable. Check the browser permission or upload a file instead.");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording" || recorderRef.current?.state === "paused") recorderRef.current.stop();
  }

  function pauseRecording() {
    const recorder = recorderRef.current;
    if (recorder?.state !== "recording") return;
    try {
      recorder.pause();
    } catch {
      setError("Recording could not be paused. Try again or stop this take.");
      return;
    }
    pausedAtRef.current = Date.now();
    setElapsed(activeSeconds());
    sessionBaseRef.current = transcriptRef.current;
    latestFinalRef.current = transcriptRef.current;
    setFinalTranscript(transcriptRef.current);
    setInterimTranscript("");
    stopTranscription();
    recognitionRef.current = null;
    stopMeter();
    setPaused(true);
  }

  function resumeRecording() {
    if (pendingRef.current || recorderRef.current?.state !== "paused") return;
    pendingRef.current = true;
    setResuming(true);
    setCountdown(3);
    const tick = (remaining: number) => {
      countdownTimerRef.current = window.setTimeout(() => {
        if (!pendingRef.current || !mountedRef.current) return;
        if (remaining > 1) {
          setCountdown(remaining - 1);
          tick(remaining - 1);
          return;
        }
        countdownTimerRef.current = null;
        pendingRef.current = false;
        setCountdown(null);
        setResuming(false);
        finishResume();
      }, 1000);
    };
    tick(3);
  }

  function finishResume() {
    const recorder = recorderRef.current;
    if (recorder?.state !== "paused") return;
    try {
      recorder.resume();
    } catch {
      setError("Recording could not resume. You can stop and keep this take.");
      return;
    }
    totalPausedMsRef.current += Date.now() - (pausedAtRef.current ?? Date.now());
    pausedAtRef.current = null;
    setError(null);
    if (streamRef.current) startMeter(streamRef.current);
    recordingActiveRef.current = true;
    setPaused(false);
    startTranscription();
  }

  function cancelCountdown() {
    pendingRef.current = false;
    if (countdownTimerRef.current !== null) window.clearTimeout(countdownTimerRef.current);
    countdownTimerRef.current = null;
    setCountdown(null);
    if (recording && paused) {
      setResuming(false);
      return;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    stopMeter();
  }

  function requestRecordAgain() {
    try {
      if (window.localStorage.getItem(SKIP_RECORD_AGAIN_CONFIRMATION) === "true") {
        void startRecording();
        return;
      }
    } catch { /* Recording still works when browser storage is unavailable. */ }
    setDoNotShowAgain(false);
    setConfirmRecordAgain(true);
  }

  function confirmNewRecording() {
    if (doNotShowAgain) {
      try { window.localStorage.setItem(SKIP_RECORD_AGAIN_CONFIRMATION, "true"); }
      catch { /* Keep the current choice for this attempt. */ }
    }
    setConfirmRecordAgain(false);
    void startRecording();
  }

  function clearSelection() {
    if (submitting || pendingRef.current) return;
    if (recording) stopRecording();
    setSelected(null);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setFilename("");
    setElapsed(0);
    setError(null);
    clearTranscript();
  }

  async function submitSelection() {
    if (!selected || submitting || disabled || pendingRef.current) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(selected, filename);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "The recording could not be created. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const maxMegabytes = Math.round(maxAudioBytes / 1024 / 1024);
  const hint = "text-sm text-muted on-dark:text-cream/80";
  const recordedAudio = selected !== null && !(selected instanceof File);
  const feedback = liveFeedback(joinTranscript(finalTranscript, interimTranscript), elapsed);
  const paceText = feedback.pace === null ? recording ? "Collecting speech…" : "Not enough speech to estimate pace" : feedback.pace < 135 ? "Below target pace" : feedback.pace > 155 ? "Above target pace" : "Within target pace";
  const pacePosition = feedback.pace === null ? 0 : Math.max(0, Math.min(100, ((feedback.pace - 80) / 120) * 100));
  const paceMarkerColor = feedback.pace !== null && feedback.pace > 155 ? "bg-rose ring-rose" : feedback.pace !== null && feedback.pace >= 135 ? "bg-mint ring-mint" : "bg-peach ring-peach";

  return (
    <section className="flex w-full flex-col gap-5" aria-label={live ? "Recording upload" : "Demo recording upload"}>
      {/* Each control sits with the limits that apply to it. */}
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <div className="flex flex-wrap items-start gap-2">
          <button type="button" className={buttonClass("accent")} disabled={submitting || disabled || preparing} onClick={recording ? stopRecording : countdown !== null ? cancelCountdown : recordedAudio ? requestRecordAgain : startRecording}>
            {preparing ? "Opening microphone…" : recording ? "■ Stop recording" : countdown !== null ? "Cancel countdown" : recordedAudio ? "● Record again" : "● Record audio"}
          </button>
          {recording && <button type="button" className={buttonClass("secondary")} disabled={submitting || disabled} onClick={resuming ? cancelCountdown : paused ? resumeRecording : pauseRecording}>{resuming ? "Cancel countdown" : paused ? "▶ Resume recording" : "Ⅱ Pause recording"}</button>}
        </div>
        <div className="flex flex-col items-start gap-2">
          <label className={buttonClass("secondary")}>
            ↑ Upload audio
            <input
              type="file"
              accept=".wav,.mp3,.m4a,.webm,audio/*"
              className="sr-only"
              disabled={recording || preparing || countdown !== null || submitting || disabled}
              onChange={(event) => {
                chooseFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
          </label>
          <p className={hint}>WAV, MP3, M4A or WebM, up to {maxMegabytes} MB.</p>
        </div>
      </div>

      {confirmRecordAgain && (
        <dialog ref={confirmationDialogRef} onClose={() => setConfirmRecordAgain(false)} onCancel={() => setConfirmRecordAgain(false)} aria-labelledby="record-again-title" aria-describedby="record-again-description" className="m-auto w-[min(92vw,28rem)] rounded-2xl border-2 border-outline bg-card p-6 text-ink shadow-xl backdrop:bg-night/70">
          <h3 id="record-again-title" className="font-display text-2xl font-bold">Record again?</h3>
          <p id="record-again-description" className="mt-2 text-sm text-muted">Your current recording will be replaced when the new recording starts and cannot be recovered.</p>
          <label className="mt-5 flex w-fit items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={doNotShowAgain} onChange={(event) => setDoNotShowAgain(event.target.checked)} className="size-4 accent-teal" />
            Don’t show again
          </label>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button type="button" className={buttonClass("secondary")} onClick={() => setConfirmRecordAgain(false)}>Keep this take</button>
            <button type="button" className={buttonClass("accent")} onClick={confirmNewRecording}>Record again</button>
          </div>
        </dialog>
      )}

      {countdown !== null && (
        <div className="flex items-center gap-4 rounded-2xl border-2 border-peach bg-night-soft px-5 py-4 text-cream" role="status" aria-live="assertive">
          <span className="font-display text-6xl font-bold text-peach" aria-hidden="true">{countdown}</span>
          <span>Recording {resuming ? "resumes" : "starts"} in {countdown}…</span>
        </div>
      )}

      {/* The meter is flat until a real microphone stream feeds it. */}
      <div>
        <div className="flex h-12 items-center gap-[3px]" aria-hidden="true" data-testid="microphone-level-meter">
          {levels.map((level, index) => (
            <span
              key={index}
              className={`min-h-1 flex-1 rounded-full ${metering ? "bg-teal on-dark:bg-mint" : "bg-line on-dark:bg-night-line"}`}
              style={{ height: `${Math.round(level * 100)}%` }}
            />
          ))}
        </div>
      </div>

      {countdown === null && <p className="flex items-center gap-2 font-mono text-sm text-teal on-dark:text-mint" aria-live="polite">
        {recording && !paused && <span aria-hidden="true" className="recording-dot size-2.5 shrink-0 rounded-full bg-[#ff6b5e]" />}
        <span>{recording ? `${paused ? "PAUSED" : "RECORDING"} ${formatDuration(elapsed)} / ${formatDuration(maxAudioDurationSeconds)}` : preparing ? "OPENING MICROPHONE" : selected ? `READY · ${filename}` : live ? "READY TO ANALYZE · Audio is sent after you submit" : "DEMO ONLY · Nothing is sent to AWS"}</span>
      </p>}
      {(recording || finalTranscript || interimTranscript || transcriptNotice) && (
        <section className="flex min-w-0 flex-col gap-3" aria-label="Live transcript">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-xl font-bold text-cream">Transcript</h3>
            <span className="rounded-lg border-2 border-night-line px-2.5 py-1 font-mono text-xs text-mint">
              {paused ? "PAUSED" : recording ? "LIVE" : "RECORDED"}
            </span>
          </div>
          <div className="overflow-hidden rounded-2xl border-2 border-night-line">
            <div className="flex min-h-28 flex-col gap-2 bg-night-soft px-4 py-3 sm:flex-row sm:gap-4">
              <span className="w-24 shrink-0 pt-1 font-mono text-xs text-peach">
                {formatDuration(elapsed)} · {paused ? "PAUSED" : recording ? "LIVE" : "CAPTURED"}
              </span>
              <p className="min-w-0 whitespace-pre-wrap text-[17px] leading-relaxed text-mint" aria-live="polite">
                {finalTranscript || interimTranscript ? <>{finalTranscript}{finalTranscript && interimTranscript ? " " : ""}<span className="text-cream/65">{interimTranscript}</span></> : paused ? "Recording paused." : recording ? "Listening for speech…" : "No live words were captured."}
              </p>
            </div>
          </div>
          <div className="rounded-xl border-2 border-night-line bg-night-soft p-4" aria-label="Live speaking pace">
            <p className="font-mono text-xs uppercase text-mint">Speaking pace · live estimate</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="font-display text-3xl font-bold text-cream" aria-label={feedback.pace === null ? "Pace estimate unavailable" : `Estimated pace ${feedback.pace} words per minute`}>{feedback.pace ?? "—"} <span className="font-sans text-sm font-normal">WPM</span></p>
              <p className="text-sm text-mint" aria-live="polite">{paceText}</p>
              {feedback.pace !== null && elapsed < 15 && <span className="rounded-full border border-peach/50 px-2 py-0.5 font-mono text-xs text-peach">EARLY ESTIMATE</span>}
            </div>
            <div className="mt-5 px-2" role="img" aria-label={feedback.pace === null ? "Pace scale from 80 to 200 words per minute; target is 135 to 155; waiting for an estimate" : `Pace scale from 80 to 200 words per minute; target is 135 to 155; current estimate is ${feedback.pace}`}>
              <div className="relative h-4 rounded-full bg-night-line">
                <span className="absolute inset-y-0 rounded-full bg-mint/70" style={{ left: "45.83%", width: "16.67%" }} />
                {feedback.pace !== null && <span className={`absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-night-soft ring-2 ${paceMarkerColor}`} style={{ left: `${pacePosition}%` }} />}
              </div>
              <div className="relative mt-2 h-4 font-mono text-xs text-mint/80" aria-hidden="true"><span className="absolute left-0">80</span><span className="absolute -translate-x-1/2" style={{ left: "45.83%" }}>135</span><span className="absolute -translate-x-1/2" style={{ left: "62.5%" }}>155</span><span className="absolute right-0">200+</span></div>
              <div className="mt-2 flex justify-between text-xs text-mint" aria-hidden="true"><span>Slower</span><span>Target 135–155 WPM</span><span>Faster</span></div>
            </div>
            <PaceTrend samples={paceHistory} />
          </div>
          {transcriptNotice && <p className="text-sm text-peach" role="status">{transcriptNotice}</p>}
          <p className="text-xs text-cream/70">This pace estimate includes words still changing in your browser. Your scored review uses the submitted audio.</p>
        </section>
      )}
      {error && <p className="text-sm font-semibold text-rust on-dark:text-peach" role="alert">{error}</p>}
      {previewUrl && <audio controls src={previewUrl} className="w-full" aria-label="Preview selected audio" />}
      {selected && (
        <div className="flex flex-wrap gap-4">
          <button type="button" className={buttonClass("primary")} disabled={submitting || disabled || preparing || countdown !== null} onClick={submitSelection}>
            {submitting ? "Saving…" : submitLabel}
          </button>
          <button type="button" className={buttonClass("secondary")} disabled={submitting || disabled || preparing || countdown !== null} onClick={clearSelection}>
            Discard
          </button>
        </div>
      )}
    </section>
  );
}
