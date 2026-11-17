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
    await a.getReview("jwt", "r/1");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer jwt");
    expect(fetcher.mock.calls[1][0]).toContain("a%2Fb/recordings");
    expect(fetcher.mock.calls[3][0]).toContain("r%2F1/artifacts/analysis");
    expect(fetcher.mock.calls[6][0]).toBe("https://example.test/recordings/r%2F1/review");
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
