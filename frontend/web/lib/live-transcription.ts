import { createTranscriptionStream, type TranscriptionStreamSession } from "@/lib/api";

const AUDIO_BUFFER_SIZE = 2048;
const CONNECT_TIMEOUT_MS = 10_000;
const FINAL_RESULT_TIMEOUT_MS = 2_000;
const MIN_WPM_WORDS = 3;
const MIN_WPM_SECONDS = 3;

type EventStreamMessage = {
  headers: Record<string, string>;
  payload: Uint8Array;
};

type TranscribeItem = {
  Content?: string;
  EndTime?: number;
  StartTime?: number;
  Type?: "pronunciation" | "punctuation";
};

export type TranscribeResult = {
  Alternatives?: Array<{ Items?: TranscribeItem[]; Transcript?: string }>;
  EndTime?: number;
  IsPartial?: boolean;
  ResultId?: string;
  StartTime?: number;
};

type TranscriptEventDocument = {
  Transcript?: { Results?: TranscribeResult[] };
};

type Segment = {
  endTime?: number;
  isPartial: boolean;
  items: TranscribeItem[];
  key: string;
  startTime?: number;
  text: string;
};

export type LiveTranscriptSnapshot = {
  finalText: string;
  partialText: string;
  transcript: string;
  wordCount: number;
  wordsPerMinute: number | null;
};

export type LiveTranscriptionState = "connecting" | "streaming" | "stopped" | "error";

export type LiveTranscriptionController = {
  abort: () => void;
  stop: () => Promise<void>;
};

type StartOptions = {
  accessToken: string;
  mediaStream: MediaStream;
  onError: (message: string) => void;
  onSnapshot: (snapshot: LiveTranscriptSnapshot) => void;
  onStateChange: (state: LiveTranscriptionState) => void;
  signal?: AbortSignal;
  createSession?: (token: string, signal?: AbortSignal) => Promise<TranscriptionStreamSession>;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function encodeStringHeader(name: string, value: string) {
  const nameBytes = textEncoder.encode(name);
  const valueBytes = textEncoder.encode(value);
  const header = new Uint8Array(1 + nameBytes.length + 1 + 2 + valueBytes.length);
  const view = new DataView(header.buffer);
  header[0] = nameBytes.length;
  header.set(nameBytes, 1);
  header[1 + nameBytes.length] = 7;
  view.setUint16(2 + nameBytes.length, valueBytes.length, false);
  header.set(valueBytes, 4 + nameBytes.length);
  return header;
}

export function encodeEventStreamMessage(headerValues: Record<string, string>, payload: Uint8Array) {
  const headers = concatBytes(
    Object.entries(headerValues).map(([name, value]) => encodeStringHeader(name, value)),
  );
  const totalLength = 16 + headers.length + payload.length;
  const message = new Uint8Array(totalLength);
  const view = new DataView(message.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headers.length, false);
  view.setUint32(8, crc32(message.subarray(0, 8)), false);
  message.set(headers, 12);
  message.set(payload, 12 + headers.length);
  view.setUint32(totalLength - 4, crc32(message.subarray(0, totalLength - 4)), false);
  return message;
}

export function encodeAudioEvent(payload: Uint8Array) {
  return encodeEventStreamMessage({
    ":content-type": "application/octet-stream",
    ":event-type": "AudioEvent",
    ":message-type": "event",
  }, payload);
}

export function decodeEventStreamMessages(input: ArrayBuffer | Uint8Array): EventStreamMessage[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const messages: EventStreamMessage[] = [];
  let messageOffset = 0;
  while (messageOffset < bytes.length) {
    if (bytes.length - messageOffset < 16) throw new Error("Incomplete Transcribe event stream message");
    const view = new DataView(bytes.buffer, bytes.byteOffset + messageOffset);
    const totalLength = view.getUint32(0, false);
    const headersLength = view.getUint32(4, false);
    if (totalLength < 16 || messageOffset + totalLength > bytes.length || headersLength > totalLength - 16) {
      throw new Error("Invalid Transcribe event stream lengths");
    }
    const message = bytes.subarray(messageOffset, messageOffset + totalLength);
    if (view.getUint32(8, false) !== crc32(message.subarray(0, 8))) {
      throw new Error("Invalid Transcribe prelude checksum");
    }
    if (view.getUint32(totalLength - 4, false) !== crc32(message.subarray(0, totalLength - 4))) {
      throw new Error("Invalid Transcribe message checksum");
    }
    const headers: Record<string, string> = {};
    let headerOffset = 12;
    const headersEnd = 12 + headersLength;
    while (headerOffset < headersEnd) {
      const nameLength = message[headerOffset];
      const nameStart = headerOffset + 1;
      const nameEnd = nameStart + nameLength;
      const headerType = message[nameEnd];
      if (headerType !== 7) throw new Error("Unsupported Transcribe event stream header");
      const valueLength = new DataView(
        message.buffer,
        message.byteOffset + nameEnd + 1,
        2,
      ).getUint16(0, false);
      const valueStart = nameEnd + 3;
      const valueEnd = valueStart + valueLength;
      if (valueEnd > headersEnd) throw new Error("Invalid Transcribe event stream header length");
      headers[textDecoder.decode(message.subarray(nameStart, nameEnd))] = textDecoder.decode(
        message.subarray(valueStart, valueEnd),
      );
      headerOffset = valueEnd;
    }
    messages.push({
      headers,
      payload: message.slice(headersEnd, totalLength - 4),
    });
    messageOffset += totalLength;
  }
  return messages;
}

export function floatToPcm16(input: Float32Array, inputSampleRate: number, outputSampleRate: number) {
  if (inputSampleRate < outputSampleRate) {
    throw new Error("Microphone sample rate is below the Transcribe sample rate");
  }
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Uint8Array(outputLength * 2);
  const view = new DataView(output.buffer);
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(input.length, Math.floor((outputIndex + 1) * ratio));
    let sum = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) sum += input[inputIndex];
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    view.setInt16(outputIndex * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return output;
}

function segmentKey(result: TranscribeResult, index: number) {
  if (typeof result.StartTime === "number") return `start:${result.StartTime.toFixed(3)}`;
  return result.ResultId ? `id:${result.ResultId}` : `index:${index}`;
}

export function calculateLiveWpm(wordCount: number, elapsedSeconds: number, firstWordSeconds = 0) {
  const speakingWindow = elapsedSeconds - firstWordSeconds;
  if (wordCount < MIN_WPM_WORDS || speakingWindow < MIN_WPM_SECONDS) return null;
  return Math.round((wordCount * 60) / speakingWindow);
}

export class TranscriptAccumulator {
  private readonly segments = new Map<string, Segment>();

  add(results: TranscribeResult[]) {
    results.forEach((result, index) => {
      const alternative = result.Alternatives?.[0];
      const text = alternative?.Transcript?.trim() ?? "";
      if (!text) return;
      const key = segmentKey(result, index);
      this.segments.set(key, {
        endTime: result.EndTime,
        isPartial: result.IsPartial !== false,
        items: alternative?.Items ?? [],
        key,
        startTime: result.StartTime,
        text,
      });
    });
  }

  snapshot(elapsedSeconds: number): LiveTranscriptSnapshot {
    const ordered = [...this.segments.values()].sort((left, right) =>
      (left.startTime ?? Number.MAX_SAFE_INTEGER) - (right.startTime ?? Number.MAX_SAFE_INTEGER)
      || left.key.localeCompare(right.key),
    );
    const finalText = ordered.filter((segment) => !segment.isPartial).map((segment) => segment.text).join(" ");
    const partialText = ordered.filter((segment) => segment.isPartial).map((segment) => segment.text).join(" ");
    const transcript = [finalText, partialText].filter(Boolean).join(" ");
    const pronunciationItems = ordered.flatMap((segment) =>
      segment.items.filter((item) => item.Type === "pronunciation"),
    );
    const wordCount = ordered.reduce((total, segment) => {
      const timedWords = segment.items.filter((item) => item.Type === "pronunciation").length;
      return total + (timedWords || segment.text.split(/\s+/u).filter(Boolean).length);
    }, 0);
    const timedStarts = pronunciationItems
      .map((item) => item.StartTime)
      .filter((value): value is number => typeof value === "number");
    const segmentStarts = ordered
      .map((segment) => segment.startTime)
      .filter((value): value is number => typeof value === "number");
    const starts = timedStarts.length ? timedStarts : segmentStarts;
    const firstWordSeconds = starts.length ? Math.min(...starts) : 0;
    return {
      finalText,
      partialText,
      transcript,
      wordCount,
      wordsPerMinute: calculateLiveWpm(wordCount, elapsedSeconds, firstWordSeconds),
    };
  }
}

function exceptionMessage(message: EventStreamMessage) {
  const fallback = message.headers[":exception-type"] || "Transcribe streaming failed";
  try {
    const document = JSON.parse(textDecoder.decode(message.payload)) as { Message?: string; message?: string };
    return document.Message || document.message || fallback;
  } catch {
    return textDecoder.decode(message.payload) || fallback;
  }
}

function waitForSocketOpen(socket: WebSocket, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Live transcription connection timed out"));
    }, CONNECT_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timeout);
      socket.removeEventListener("open", opened);
      socket.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const opened = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Live transcription could not connect")); };
    const aborted = () => { cleanup(); socket.close(); reject(new DOMException("Aborted", "AbortError")); };
    socket.addEventListener("open", opened, { once: true });
    socket.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
  });
}

export async function startLiveTranscription({
  accessToken,
  mediaStream,
  onError,
  onSnapshot,
  onStateChange,
  signal,
  createSession = createTranscriptionStream,
}: StartOptions): Promise<LiveTranscriptionController> {
  const internalAbort = new AbortController();
  const abort = () => internalAbort.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const detachAbortListener = () => signal?.removeEventListener("abort", abort);
  onStateChange("connecting");
  let socket: WebSocket | null = null;
  let audioContext: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let silentOutput: GainNode | null = null;
  let snapshotTimer: number | null = null;
  let stopping = false;
  let failed = false;
  const accumulator = new TranscriptAccumulator();
  let startedAt = performance.now();

  const closeAudio = async () => {
    if (snapshotTimer !== null) window.clearInterval(snapshotTimer);
    snapshotTimer = null;
    if (processor) processor.onaudioprocess = null;
    source?.disconnect();
    processor?.disconnect();
    silentOutput?.disconnect();
    source = null;
    processor = null;
    silentOutput = null;
    await audioContext?.close().catch(() => undefined);
    audioContext = null;
  };

  try {
    const session = await createSession(accessToken, internalAbort.signal);
    if (internalAbort.signal.aborted) throw new DOMException("Aborted", "AbortError");
    socket = new WebSocket(session.websocket_url);
    socket.binaryType = "arraybuffer";
    await waitForSocketOpen(socket, internalAbort.signal);

    const AudioContextClass = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser cannot stream microphone audio");
    audioContext = new AudioContextClass({ sampleRate: session.sample_rate_hz });
    await audioContext.resume();
    if (internalAbort.signal.aborted) throw new DOMException("Aborted", "AbortError");
    source = audioContext.createMediaStreamSource(mediaStream);
    processor = audioContext.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);
    silentOutput = audioContext.createGain();
    silentOutput.gain.value = 0;
    const activeSocket = socket;
    const activeContext = audioContext;
    processor.onaudioprocess = (event) => {
      if (activeSocket.readyState !== WebSocket.OPEN) return;
      const pcm = floatToPcm16(
        event.inputBuffer.getChannelData(0),
        activeContext.sampleRate,
        session.sample_rate_hz,
      );
      activeSocket.send(encodeAudioEvent(pcm));
    };
    source.connect(processor);
    processor.connect(silentOutput);
    silentOutput.connect(audioContext.destination);
    startedAt = performance.now();
    onStateChange("streaming");
    snapshotTimer = window.setInterval(() => {
      onSnapshot(accumulator.snapshot((performance.now() - startedAt) / 1000));
    }, 1_000);

    socket.addEventListener("message", async (event) => {
      try {
        const data = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
        if (internalAbort.signal.aborted) return;
        if (!(data instanceof ArrayBuffer)) throw new Error("Unexpected Transcribe response type");
        for (const message of decodeEventStreamMessages(data)) {
          if (message.headers[":message-type"] === "exception") throw new Error(exceptionMessage(message));
          if (message.headers[":event-type"] !== "TranscriptEvent") continue;
          const document = JSON.parse(textDecoder.decode(message.payload)) as TranscriptEventDocument;
          accumulator.add(document.Transcript?.Results ?? []);
          onSnapshot(accumulator.snapshot((performance.now() - startedAt) / 1000));
        }
      } catch (error) {
        failed = true;
        onError(error instanceof Error ? error.message : "Live transcription failed");
        onStateChange("error");
        activeSocket.close();
        await closeAudio();
      }
    });
    socket.addEventListener("close", () => {
      if (!stopping && !failed && !internalAbort.signal.aborted) {
        onError("Live transcription disconnected. Your recording is still being saved.");
        onStateChange("error");
      }
      void closeAudio();
    });

    return {
      abort: () => {
        detachAbortListener();
        internalAbort.abort();
        socket?.close();
        void closeAudio();
      },
      stop: async () => {
        if (stopping) return;
        stopping = true;
        detachAbortListener();
        await closeAudio();
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(encodeAudioEvent(new Uint8Array()));
          await new Promise<void>((resolve) => {
            const timeout = window.setTimeout(resolve, FINAL_RESULT_TIMEOUT_MS);
            socket?.addEventListener("close", () => {
              window.clearTimeout(timeout);
              resolve();
            }, { once: true });
          });
          socket.close();
        }
        onSnapshot(accumulator.snapshot((performance.now() - startedAt) / 1000));
        onStateChange("stopped");
      },
    };
  } catch (error) {
    await closeAudio();
    socket?.close();
    detachAbortListener();
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    onError(error instanceof Error ? error.message : "Live transcription failed");
    onStateChange("error");
    throw error;
  }
}
