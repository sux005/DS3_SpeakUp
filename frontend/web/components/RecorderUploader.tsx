"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/Button";
import { liveFeedback } from "@/lib/live-feedback";

export type RecorderStatus = "idle" | "countdown" | "recording" | "ready";

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
  disabled = false,
  live = false,
}: RecorderUploaderProps) {
  const [selected, setSelected] = useState<File | Blob | null>(null);
  const [filename, setFilename] = useState("");
  const [recording, setRecording] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [confirmRecordAgain, setConfirmRecordAgain] = useState(false);
  const [doNotShowAgain, setDoNotShowAgain] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
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
    if (!recording) return;
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsed(seconds);
      if (seconds >= maxAudioDurationSeconds) recorderRef.current?.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [maxAudioDurationSeconds, recording]);

  const status: RecorderStatus = recording ? "recording" : preparing || countdown !== null ? "countdown" : selected ? "ready" : "idle";
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
    setFinalTranscript("");
    setInterimTranscript("");
    setTranscriptNotice(null);
    sessionBaseRef.current = "";
    latestFinalRef.current = "";
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
      setInterimTranscript(interimParts.join(" ").trim());
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

  async function startRecording() {
    if (pendingRef.current || recording) return;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("This browser does not support microphone recording. Upload an audio file instead.");
      return;
    }
    pendingRef.current = true;
    setPreparing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data);
      recorder.onstop = () => {
        stopTranscription();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        stopMeter();
        setRecording(false);
        if (validate(blob)) {
          selectAudio(blob, `speakup-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${extensionFor(blob)}`, true);
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
        } catch {
          audioContextRef.current = null;
          analyserRef.current = null;
        }
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
          try {
            recorder.start();
            startedAtRef.current = Date.now();
            setElapsed(0);
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = null;
            setPreviewUrl(null);
            setSelected(null);
            setFilename("");
            clearTranscript();
            setMetering(Boolean(analyserRef.current));
            recordingActiveRef.current = true;
            pendingRef.current = false;
            setRecording(true);
            startTranscription();
          } catch {
            stream.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
            recorderRef.current = null;
            pendingRef.current = false;
            stopMeter();
            setError("Recording could not start. Try again or upload a file instead.");
          }
        }, 1000);
      };
      tick(3);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      stopMeter();
      pendingRef.current = false;
      setPreparing(false);
      setCountdown(null);
      setRecording(false);
      setError("Microphone access was unavailable. Check the browser permission or upload a file instead.");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function cancelCountdown() {
    pendingRef.current = false;
    if (countdownTimerRef.current !== null) window.clearTimeout(countdownTimerRef.current);
    countdownTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    stopMeter();
    setCountdown(null);
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

  const maxMinutes = Math.round(maxAudioDurationSeconds / 60);
  const maxMegabytes = Math.round(maxAudioBytes / 1024 / 1024);
  const hint = "text-sm text-muted on-dark:text-cream/80";
  const recordedAudio = selected !== null && !(selected instanceof File);
  const confirmedFeedback = liveFeedback(finalTranscript, elapsed);
  const interimFeedback = liveFeedback(interimTranscript, elapsed);
  const feedback = liveFeedback(joinTranscript(finalTranscript, interimTranscript), elapsed);
  const hasRecognizedWords = feedback.spokenWords + feedback.fillerCount > 0;
  const provisionalFillers = Math.max(0, feedback.fillerCount - confirmedFeedback.fillerCount);
  const paceText = feedback.pace === null ? recording ? "Collecting speech…" : "Not enough speech to estimate pace" : feedback.pace < 135 ? "Below target pace" : feedback.pace > 155 ? "Above target pace" : "Within target pace";
  const pacePosition = feedback.pace === null ? 0 : Math.max(2, Math.min(98, (feedback.pace / 200) * 100));
  const fillerPosition = feedback.fillersPer100Words === null ? 0 : Math.max(2, Math.min(98, (feedback.fillersPer100Words / 8) * 100));

  return (
    <section className="flex w-full flex-col gap-5" aria-label={live ? "Recording upload" : "Demo recording upload"}>
      {/* Each control sits with the limits that apply to it. */}
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <div className="flex flex-col items-start gap-2">
          <button type="button" className={buttonClass("accent")} disabled={submitting || disabled || preparing} onClick={countdown !== null ? cancelCountdown : recording ? stopRecording : recordedAudio ? requestRecordAgain : startRecording}>
            {preparing ? "Opening microphone…" : countdown !== null ? "Cancel countdown" : recording ? "■ Stop recording" : recordedAudio ? "● Record again" : "● Record audio"}
          </button>
          <p className={hint}>Uses your microphone. Recording stops after {maxMinutes} {maxMinutes === 1 ? "minute" : "minutes"}. Live words may be processed by your browser’s speech service.</p>
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
            <button type="button" className={buttonClass("secondary")} onClick={() => setConfirmRecordAgain(false)}>Keep recording</button>
            <button type="button" className={buttonClass("accent")} onClick={confirmNewRecording}>Record again</button>
          </div>
        </dialog>
      )}

      {countdown !== null && (
        <div className="flex items-center gap-4 rounded-2xl border-2 border-peach bg-night-soft px-5 py-4 text-cream" role="status" aria-live="assertive">
          <span className="font-display text-6xl font-bold text-peach" aria-hidden="true">{countdown}</span>
          <span>Recording starts in {countdown}…</span>
        </div>
      )}

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
        <span>{recording ? `RECORDING ${formatDuration(elapsed)} / ${formatDuration(maxAudioDurationSeconds)}` : countdown !== null ? `STARTING IN ${countdown}` : preparing ? "OPENING MICROPHONE" : selected ? `READY · ${filename}` : live ? "READY TO ANALYZE · Audio is sent after you submit" : "DEMO ONLY · Nothing is sent to AWS"}</span>
      </p>
      {(recording || finalTranscript || interimTranscript || transcriptNotice) && (
        <section className="flex min-w-0 flex-col gap-3" aria-label="Live transcript">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-xl font-bold text-cream">Transcript</h3>
            <span className="rounded-lg border-2 border-night-line px-2.5 py-1 font-mono text-xs text-mint">
              {recording ? "LIVE" : "RECORDED"}
            </span>
          </div>
          <div className="overflow-hidden rounded-2xl border-2 border-night-line">
            <div className="flex min-h-28 flex-col gap-2 bg-night-soft px-4 py-3 sm:flex-row sm:gap-4">
              <span className="w-24 shrink-0 pt-1 font-mono text-xs text-peach">
                {formatDuration(elapsed)} · {recording ? "LIVE" : "CAPTURED"}
              </span>
              <p className="min-w-0 whitespace-pre-wrap text-[17px] leading-relaxed text-mint" aria-live="polite">
                {finalTranscript || interimTranscript ? <>{confirmedFeedback.fillerCount ? confirmedFeedback.words.map((part, index) => <span key={index} className={part.filler ? "font-semibold text-rose" : undefined}>{part.text}</span>) : finalTranscript}{finalTranscript && interimTranscript ? " " : ""}<span className="text-cream/65">{interimFeedback.fillerCount ? interimFeedback.words.map((part, index) => <span key={index} className={part.filler ? "font-semibold text-rose" : undefined}>{part.text}</span>) : interimTranscript}</span></> : recording ? "Listening for speech…" : "No live words were captured."}
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2" aria-label="Live speech estimates">
            <div className="rounded-xl border-2 border-night-line bg-night-soft p-4">
              <p className="font-mono text-xs uppercase text-mint">Filler words · live estimate</p>
              <p className="mt-1 font-display text-3xl font-bold text-cream" aria-label={hasRecognizedWords ? `${feedback.fillerCount} estimated filler words` : "Filler estimate unavailable"}>{hasRecognizedWords ? feedback.fillerCount : "—"}</p>
              <div className="relative my-3 h-2 rounded-full bg-night-line" role="presentation">
                <span className="absolute inset-y-0 left-0 w-1/4 rounded-full bg-mint/70" />
                {hasRecognizedWords && <span className="absolute -top-1 size-4 -translate-x-1/2 rounded-full border-2 border-night-soft bg-rose" style={{ left: `${fillerPosition}%` }} />}
              </div>
              <p className="text-sm text-mint">{feedback.fillersPer100Words === null ? "Waiting for recognized words" : `${feedback.fillersPer100Words.toFixed(1)} per 100 spoken words`} · target under 2</p>
              {provisionalFillers > 0 && <p className="mt-1 text-xs text-cream/70">Includes {provisionalFillers} provisional {provisionalFillers === 1 ? "filler" : "fillers"}</p>}
            </div>
            <div className="rounded-xl border-2 border-night-line bg-night-soft p-4">
              <p className="font-mono text-xs uppercase text-mint">Speaking pace · live estimate</p>
              <p className="mt-1 font-display text-3xl font-bold text-cream" aria-label={feedback.pace === null ? "Pace estimate unavailable" : `Estimated pace ${feedback.pace} words per minute`}>{feedback.pace ?? "—"} <span className="font-sans text-sm font-normal">WPM</span></p>
              <div className="relative my-3 h-2 rounded-full bg-night-line" role="presentation">
                <span className="absolute inset-y-0 rounded-full bg-mint/70" style={{ left: "67.5%", width: "10%" }} />
                {feedback.pace !== null && <span className="absolute -top-1 size-4 -translate-x-1/2 rounded-full border-2 border-night-soft bg-peach" style={{ left: `${pacePosition}%` }} />}
              </div>
              <p className="text-sm text-mint">{paceText} · target 135–155 WPM</p>
            </div>
          </div>
          {transcriptNotice && <p className="text-sm text-peach" role="status">{transcriptNotice}</p>}
          <p className="text-xs text-cream/70">Live estimates include words still changing in your browser. Browser recognition may miss filler sounds; your scored review uses the submitted audio.</p>
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
