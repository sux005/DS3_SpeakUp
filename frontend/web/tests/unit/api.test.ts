import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
async function api() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SPEAKUP_API_URL", "https://example.test");
  return import("@/lib/api");
}
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
describe("preserved AWS API contract helpers", () => {
  it("sends authenticated requests and encodes recording/project identifiers", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ items: [] }));
    vi.stubGlobal("fetch", fetcher);
    const a = await api();
    await a.getProjects("jwt");
    await a.getProjectRecordings("jwt", "a/b");
    await a.getRecording("jwt", "r/1");
    await a.getArtifact("jwt", "r/1", "analysis");
    await a.getDownloadUrl("jwt", "r/1");
    await a.getAccountLimits("jwt");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer jwt");
    expect(fetcher.mock.calls[1][0]).toContain("a%2Fb/recordings");
    expect(fetcher.mock.calls[3][0]).toContain("r%2F1/artifacts/analysis");
  });
  it("uses the fixed example routes with authenticated, encoded requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ recordings: [], download_url: "https://download.test" }));
    vi.stubGlobal("fetch", fetcher);
    const a = await api();
    await a.getExamples("jwt");
    await a.getExampleRecording("jwt", "example/strong");
    await a.getExampleDownloadUrl("jwt", "example/strong");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://example.test/examples",
      "https://example.test/examples/example%2Fstrong",
      "https://example.test/examples/example%2Fstrong/download",
    ]);
    expect(fetcher.mock.calls.every(([, init]) => init.headers.Authorization === "Bearer jwt")).toBe(true);
  });
  it("creates projects and normalizes completed reviews", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ project_id: "p1", project_title: "Talk", description: "", created_at: "2026-01-01" }, 201))
      .mockResolvedValueOnce(response({
        recording_id: "r/1",
        transcript: { text: "Hello", items: [] },
        summary_metrics: { duration_seconds: 1, words_per_minute: 60, fillers_per_100_words: 0, pauses_per_speaking_minute: 0, rubric_scores: { speaking_rate: 4, filler_words: 4, pauses_inside_sentences: 4 } },
        feedback: null,
      }));
    vi.stubGlobal("fetch", fetcher);
    const a = await api();
    await expect(a.createProject("jwt", "Talk", "Notes")).resolves.toMatchObject({ project_id: "p1" });
    await expect(a.getReview("jwt", "r/1")).resolves.toMatchObject({ recording_id: "r/1", summary_metrics: { duration_seconds: 1 }, feedback: null });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify({ project_title: "Talk", description: "Notes" }) });
    expect(fetcher.mock.calls[1][0]).toContain("r%2F1/review");
  });

  it("loads Bedrock feedback from artifacts when the deployed API lacks /review", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/review")) return Promise.resolve(response({ message: "Resource not found" }, 404));
      if (url.endsWith("/artifacts/transcript")) return Promise.resolve(response({ data: { text: "A clear opening", items: [{ type: "pronunciation", start_time: "0", end_time: "1", alternatives: [{ content: "A" }] }] } }));
      if (url.endsWith("/artifacts/analysis")) return Promise.resolve(response({ data: { metrics: { words_per_minute: 120 } } }));
      if (url.endsWith("/artifacts/feedback")) return Promise.resolve(response({ data: { feedback: "Lead with your main point.", schema_version: 2, categories: { general: { observation: "Clear opening.", next_step: "Keep the main point first." } }, moments: [{ id: "s1", start_seconds: 0, end_seconds: 1, text: "A", kind: "strength", observation: "Clear opening.", next_step: "Keep it." }] } }));
      return Promise.resolve(response({ recording_id: "r1", summary_metrics: { words_per_minute: 120 } }));
    });
    vi.stubGlobal("fetch", fetcher);
    const a = await api();
    await expect(a.loadRecordingReview("", "r1")).resolves.toMatchObject({
      recording_id: "r1",
      transcript: { text: "A clear opening" },
      analysis: { words_per_minute: 120 },
      feedback: { feedback: "Lead with your main point.", schema_version: 2, categories: { general: { next_step: "Keep the main point first." } }, moments: [{ id: "s1", kind: "strength" }] },
    });
    expect(fetcher.mock.calls.every(([, init]) => !init.headers.Authorization)).toBe(true);
  });

  it("keeps structured feedback from the review route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) =>
      Promise.resolve(url.endsWith("/review")
        ? response({ recording_id: "r1", transcript: { text: "Hello", items: [] }, feedback: { feedback: "Clear opening.", categories: { general: { observation: "Clear.", next_step: "Keep it." } }, moments: [{ id: "s1", kind: "strength" }] } })
        : response({ data: { metrics: { words_per_minute: 120 } } })),
    ));
    const a = await api();
    await expect(a.loadRecordingReview("", "r1")).resolves.toMatchObject({ feedback: { categories: { general: { next_step: "Keep it." } }, moments: [{ id: "s1" }] } });
  });

  it("keeps feedback nullable when the artifact is absent on an older API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/review") || url.endsWith("/artifacts/feedback")) return Promise.resolve(response({ message: "Resource not found" }, 404));
      if (url.endsWith("/artifacts/transcript")) return Promise.resolve(response({ data: { text: "Hello", items: [] } }));
      if (url.endsWith("/artifacts/analysis")) return Promise.resolve(response({ data: { metrics: { words_per_minute: 100 } } }));
      return Promise.resolve(response({ recording_id: "r1" }));
    }));
    const a = await api();
    await expect(a.loadRecordingReview("", "r1")).resolves.toMatchObject({ feedback: null, transcript: { text: "Hello" } });
  });

  it("supports cursors and exposes all authenticated client operations", async () => {
    const review = { recording_id: "r1", transcript: { text: "Hi", items: [] }, feedback: null };
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/review")) return Promise.resolve(response(review));
      if (url.includes("/artifacts/analysis")) return Promise.resolve(response({ data: { metrics: { duration_seconds: 1 } } }));
      return Promise.resolve(response({ items: [], recording_id: "r1", download_url: "https://download.test" }));
    });
    vi.stubGlobal("fetch", fetcher);
    const a = await api();
    const client = a.createApiClient("jwt");
    await client.getProjects("next page");
    await client.getProjectRecordings("p/1", "next page");
    await client.getRecording("r/1");
    await client.getRecordingReview("r/1");
    await client.getReview("r/1");
    await expect(client.loadRecordingReview("r/1")).resolves.toMatchObject({ analysis: { duration_seconds: 1 } });
    await client.getArtifact("r/1", "feedback");
    await client.getDownloadUrl("r/1");
    await client.getAccountLimits();
    expect(fetcher.mock.calls[0][0]).toContain("cursor=next%20page");
    expect(fetcher.mock.calls[1][0]).toContain("p%2F1/recordings?cursor=next%20page");
  });

  it("returns the recording ID after a signed upload reservation completes", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ recording_id: "r-retry", upload_url: "https://upload.test", required_headers: { "x-amz-meta": "signed" } }))
      .mockResolvedValueOnce(response({}));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(0)) }, randomUUID: vi.fn(() => "unused") });
    const a = await api();
    const file = { type: "audio/wav", size: 0, arrayBuffer: async () => new ArrayBuffer(0) } as File;
    await expect(a.reserveAndUploadRecording("jwt", "p1", file, undefined, "stable-retry")).resolves.toBe("r-retry");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ idempotency_key: "stable-retry" });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "PUT", headers: { "x-amz-meta": "signed" }, body: file });
  });

  it("binds project creation, reservation, and polling methods on the client", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ project_id: "p1" }, 201))
      .mockResolvedValueOnce(response({ recording_id: "r1", upload_url: "https://upload.test", required_headers: {} }))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ status: "COMPLETE" }));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(0)) }, randomUUID: vi.fn(() => "client-key") });
    const a = await api();
    const client = a.createApiClient("jwt");
    await client.createProject("Talk", "Notes");
    const file = { type: "audio/wav", size: 0, arrayBuffer: async () => new ArrayBuffer(0) } as File;
    await expect(client.reserveAndUploadRecording("p1", file)).resolves.toBe("r1");
    await expect(client.waitForRecording("r1")).resolves.toEqual({ status: "COMPLETE" });
  });

  it("binds authentication and preserves an explicit upload idempotency key", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ recording_id: "r1", upload_url: "https://upload.test", required_headers: {} }))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ status: "COMPLETE" }));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(0)) }, randomUUID: vi.fn(() => "generated") });
    const a = await api();
    const client = a.createApiClient("jwt");
    await client.uploadRecording("p1", { type: "audio/wav", size: 0, arrayBuffer: async () => new ArrayBuffer(0) } as File, undefined, "retry-key");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ idempotency_key: "retry-key" });
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer jwt");
  });
  it("reports missing configuration and structured or non-JSON failures", async () => {
    const a = await api();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ code: "DENIED", message: "No access" }, 403)).mockResolvedValueOnce(new Response("failure", { status: 500, statusText: "Server error" })));
    await expect(a.getProjects("jwt")).rejects.toMatchObject({ status: 403, code: "DENIED", message: "No access" });
    await expect(a.getProjects("jwt")).rejects.toThrow("Server error");
    vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_SPEAKUP_API_URL", "");
    await expect((await import("@/lib/api")).getProjects("jwt")).rejects.toThrow("not set");
  });
  it("reserves, uploads with signed headers, and polls through completion", async () => {
    vi.useFakeTimers();
    const a = await api();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ recording_id: "r1", upload_url: "https://upload.test", required_headers: { "Content-Type": "audio/wav" } }))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ status: "PROCESSING" }))
      .mockResolvedValueOnce(response({ status: "COMPLETE" }));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("crypto", { randomUUID: () => "retry-key", subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array([1, 2]).buffer) } });
    const file = { type: "audio/wav", size: 2, arrayBuffer: async () => new Uint8Array([1, 2]).buffer } as File;
    const status = vi.fn();
    const pending = a.uploadRecording("jwt", "p1", file, status);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toEqual({ status: "COMPLETE" });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "PUT", headers: { "Content-Type": "audio/wav" }, body: file });
    expect(status.mock.calls.flat()).toEqual(["PROCESSING", "COMPLETE"]);
  });
  it("reports failed uploads and returns terminal failed recordings", async () => {
    const a = await api();
    vi.stubGlobal("crypto", { randomUUID: () => "retry-key", subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(0)) } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ recording_id: "r1", upload_url: "https://upload.test", required_headers: {} })).mockResolvedValueOnce(response({}, 403)).mockResolvedValueOnce(response({ status: "FAILED" })));
    await expect(a.uploadRecording("jwt", "p1", { type: "audio/wav", size: 0, arrayBuffer: async () => new ArrayBuffer(0) } as File)).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
    await expect(a.waitForRecording("jwt", "r1")).resolves.toEqual({ status: "FAILED" });
  });
});
