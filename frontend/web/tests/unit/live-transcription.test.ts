import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TranscriptAccumulator,
  calculateLiveWpm,
  decodeEventStreamMessages,
  encodeAudioEvent,
  encodeEventStreamMessage,
  floatToPcm16,
  startLiveTranscription,
} from "@/lib/live-transcription";

class FakeNode {
  connect = vi.fn(() => this);
  disconnect = vi.fn();
}

class FakeProcessor extends FakeNode {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  destination = {} as AudioDestinationNode;
  sampleRate: number;
  source = new FakeNode();
  processor = new FakeProcessor();
  gain = Object.assign(new FakeNode(), { gain: { value: 1 } });
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);

  constructor(options?: AudioContextOptions) {
    this.sampleRate = options?.sampleRate ?? 48_000;
    FakeAudioContext.instances.push(this);
  }

  createMediaStreamSource() { return this.source as unknown as MediaStreamAudioSourceNode; }
  createScriptProcessor() { return this.processor as unknown as ScriptProcessorNode; }
  createGain() { return this.gain as unknown as GainNode; }
}

class FakeSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  binaryType: BinaryType = "blob";
  readyState = FakeSocket.CONNECTING;
  sent: Uint8Array[] = [];

  constructor(public url: string) {
    super();
    FakeSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState !== FakeSocket.CONNECTING) return;
      this.readyState = FakeSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(data: ArrayBufferLike | Blob | ArrayBufferView) {
    this.sent.push(data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer));
  }

  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close"));
  }
}

const session = {
  websocket_url: "wss://transcribe.example/stream",
  expires_at: "2026-11-19T12:00:00Z",
  language_code: "en-US" as const,
  media_encoding: "pcm" as const,
  sample_rate_hz: 16_000,
  session_id: "session-1",
};

describe("Amazon event stream framing", () => {
  it("round-trips audio frames and supports more than one message", () => {
    const first = encodeAudioEvent(new Uint8Array([1, 2, 3]));
    const second = encodeAudioEvent(new Uint8Array());
    const joined = new Uint8Array(first.length + second.length);
    joined.set(first);
    joined.set(second, first.length);
    const messages = decodeEventStreamMessages(joined);
    expect(messages).toHaveLength(2);
    expect(messages[0].headers).toEqual({
      ":content-type": "application/octet-stream",
      ":event-type": "AudioEvent",
      ":message-type": "event",
    });
    expect([...messages[0].payload]).toEqual([1, 2, 3]);
    expect(messages[1].payload).toHaveLength(0);
  });

  it("rejects incomplete, malformed, and checksum-corrupted frames", () => {
    expect(() => decodeEventStreamMessages(new Uint8Array(5))).toThrow("Incomplete");
    const invalidLength = encodeAudioEvent(new Uint8Array([1]));
    new DataView(invalidLength.buffer).setUint32(0, 15, false);
    expect(() => decodeEventStreamMessages(invalidLength)).toThrow("lengths");
    const badPrelude = encodeAudioEvent(new Uint8Array([1]));
    badPrelude[8] ^= 1;
    expect(() => decodeEventStreamMessages(badPrelude)).toThrow("prelude checksum");
    const badMessage = encodeAudioEvent(new Uint8Array([1]));
    badMessage[badMessage.length - 1] ^= 1;
    expect(() => decodeEventStreamMessages(badMessage)).toThrow("message checksum");
  });
});

describe("live transcript calculations", () => {
  it("downsamples, clamps, and writes signed little-endian PCM", () => {
    const pcm = floatToPcm16(new Float32Array([-2, -1, 0.5, 2]), 32_000, 16_000);
    const view = new DataView(pcm.buffer);
    expect(view.getInt16(0, true)).toBe(-32768);
    expect(view.getInt16(2, true)).toBe(32767);
    expect(() => floatToPcm16(new Float32Array([0]), 8_000, 16_000)).toThrow("below");
  });

  it("holds WPM until it has a useful window", () => {
    expect(calculateLiveWpm(2, 10)).toBeNull();
    expect(calculateLiveWpm(10, 2)).toBeNull();
    expect(calculateLiveWpm(15, 9, 3)).toBe(150);
  });

  it("replaces partial text with final text and counts pronunciation items", () => {
    const accumulator = new TranscriptAccumulator();
    accumulator.add([{
      ResultId: "partial-1",
      StartTime: 1,
      EndTime: 2,
      IsPartial: true,
      Alternatives: [{ Transcript: "Hello wor", Items: [
        { Content: "Hello", Type: "pronunciation", StartTime: 1, EndTime: 1.4 },
        { Content: "wor", Type: "pronunciation", StartTime: 1.5, EndTime: 2 },
      ] }],
    }]);
    expect(accumulator.snapshot(2).partialText).toBe("Hello wor");
    accumulator.add([{
      ResultId: "final-1",
      StartTime: 1,
      EndTime: 3,
      IsPartial: false,
      Alternatives: [{ Transcript: "Hello world today", Items: [
        { Content: "Hello", Type: "pronunciation", StartTime: 1, EndTime: 1.4 },
        { Content: "world", Type: "pronunciation", StartTime: 1.5, EndTime: 2 },
        { Content: "today", Type: "pronunciation", StartTime: 2.2, EndTime: 3 },
        { Content: ".", Type: "punctuation" },
      ] }],
    }]);
    accumulator.add([{ ResultId: "later", StartTime: 4, IsPartial: true, Alternatives: [{ Transcript: "Next" }] }]);
    const snapshot = accumulator.snapshot(5);
    expect(snapshot.finalText).toBe("Hello world today");
    expect(snapshot.partialText).toBe("Next");
    expect(snapshot.transcript).toBe("Hello world today Next");
    expect(snapshot.wordCount).toBe(4);
    expect(snapshot.wordsPerMinute).toBe(60);
  });

  it("falls back to transcript words when item timestamps are absent", () => {
    const accumulator = new TranscriptAccumulator();
    accumulator.add([{ Alternatives: [{ Transcript: "one two three four" }], IsPartial: false }]);
    expect(accumulator.snapshot(4)).toMatchObject({ wordCount: 4, wordsPerMinute: 60 });
  });
});

describe("browser streaming lifecycle", () => {
  beforeEach(() => {
    FakeAudioContext.instances = [];
    FakeSocket.instances = [];
    Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
    vi.stubGlobal("WebSocket", FakeSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("streams PCM, emits partial/final snapshots, and sends an empty end frame", async () => {
    const onSnapshot = vi.fn();
    const onStateChange = vi.fn();
    const controller = await startLiveTranscription({
      accessToken: "jwt",
      mediaStream: {} as MediaStream,
      onError: vi.fn(),
      onSnapshot,
      onStateChange,
      createSession: vi.fn().mockResolvedValue(session),
    });
    const socket = FakeSocket.instances[0];
    const context = FakeAudioContext.instances[0];
    context.processor.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array([0, 0.5, -0.5]) },
    } as unknown as AudioProcessingEvent);
    expect(decodeEventStreamMessages(socket.sent[0])[0].payload.length).toBeGreaterThan(0);

    const transcriptFrame = encodeEventStreamMessage({
      ":content-type": "application/json",
      ":event-type": "TranscriptEvent",
      ":message-type": "event",
    }, new TextEncoder().encode(JSON.stringify({ Transcript: { Results: [{
      ResultId: "one",
      StartTime: 0,
      IsPartial: true,
      Alternatives: [{ Transcript: "Hello there" }],
    }] } })));
    socket.dispatchEvent(new MessageEvent("message", { data: transcriptFrame.buffer }));
    await vi.waitFor(() => expect(onSnapshot).toHaveBeenCalled());
    expect(onSnapshot.mock.calls.at(-1)?.[0].partialText).toBe("Hello there");

    const stopping = controller.stop();
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    socket.close();
    await stopping;
    const endMessage = decodeEventStreamMessages(socket.sent.at(-1)!)[0];
    expect(endMessage.payload).toHaveLength(0);
    expect(onStateChange.mock.calls.flat()).toEqual(["connecting", "streaming", "stopped"]);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("surfaces terminal service exceptions and closes the audio graph", async () => {
    const onError = vi.fn();
    const onStateChange = vi.fn();
    await startLiveTranscription({
      accessToken: "jwt",
      mediaStream: {} as MediaStream,
      onError,
      onSnapshot: vi.fn(),
      onStateChange,
      createSession: vi.fn().mockResolvedValue(session),
    });
    const exception = encodeEventStreamMessage({
      ":content-type": "application/json",
      ":exception-type": "LimitExceededException",
      ":message-type": "exception",
    }, new TextEncoder().encode(JSON.stringify({ Message: "Too many live streams" })));
    FakeSocket.instances[0].dispatchEvent(new MessageEvent("message", { data: exception.buffer }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith("Too many live streams"));
    expect(onStateChange.mock.calls.flat()).toContain("error");
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();
  });

  it("reports session creation failures and supports aborting a pending connection", async () => {
    const onError = vi.fn();
    await expect(startLiveTranscription({
      accessToken: "jwt",
      mediaStream: {} as MediaStream,
      onError,
      onSnapshot: vi.fn(),
      onStateChange: vi.fn(),
      createSession: vi.fn().mockRejectedValue(new Error("API unavailable")),
    })).rejects.toThrow("API unavailable");
    expect(onError).toHaveBeenCalledWith("API unavailable");

    const abort = new AbortController();
    const pending = startLiveTranscription({
      accessToken: "jwt",
      mediaStream: {} as MediaStream,
      onError: vi.fn(),
      onSnapshot: vi.fn(),
      onStateChange: vi.fn(),
      signal: abort.signal,
      createSession: vi.fn().mockResolvedValue(session),
    });
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
