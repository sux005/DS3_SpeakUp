import { writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  invocations: [] as Array<Record<string, unknown>>,
  failInvocation: false,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => ({ value: state.jar.get(name) }),
    set: (name: string, value: string) => { state.jar.set(name, value); },
  }),
}));

vi.mock("node:child_process", () => ({
  execFile: (_command: string, args: string[], _options: unknown, callback: (error: Error | null) => void) => {
    if (state.failInvocation) { callback(new Error("AWS unavailable")); return; }
    void (async () => {
      const input = args[args.indexOf("--payload") + 1].replace("fileb://", "");
      const event = JSON.parse(await (await import("node:fs/promises")).readFile(input, "utf8")) as Record<string, unknown>;
      state.invocations.push(event);
      const output = args.at(-1)!;
      await writeFile(output, JSON.stringify({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [] }) }));
      callback(null);
    })().catch(callback);
  },
}));

const context = (path: string[]) => ({ params: Promise.resolve({ path }) });

beforeEach(() => {
  state.jar.clear();
  state.invocations.length = 0;
  state.failInvocation = false;
  vi.stubEnv("SPEAKUP_DEV_GUEST_MODE", "1");
  vi.stubEnv("NODE_ENV", "test");
});
afterEach(() => vi.unstubAllEnvs());

describe("local guest bridge route", () => {
  it("refuses requests when guest mode is disabled", async () => {
    vi.stubEnv("SPEAKUP_DEV_GUEST_MODE", "0");
    const { GET } = await import("@/app/api/speakup/[...path]/route");
    expect((await GET(new Request("http://localhost/api/speakup/session"), context(["session"]))).status).toBe(404);
    expect(state.invocations).toHaveLength(0);
  });

  it("creates a signed session and scopes Lambda calls to its guest owner", async () => {
    const { GET } = await import("@/app/api/speakup/[...path]/route");
    const session = await GET(new Request("http://localhost/api/speakup/session"), context(["session"]));
    expect(await session.json()).toEqual({ guest: true });
    expect(state.jar.get("speakup_guest_session")).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);
    const result = await GET(new Request("http://localhost/api/speakup/projects?cursor=next"), context(["projects"]));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({ items: [] });
    expect(state.invocations[0]).toMatchObject({
      routeKey: "GET /projects",
      queryStringParameters: { cursor: "next" },
      requestContext: { authorizer: { jwt: { claims: { sub: expect.stringMatching(/^guest-[0-9a-f-]{36}$/) } } } },
    });
  });

  it("blocks routes outside the guest allowlist", async () => {
    const { GET, POST } = await import("@/app/api/speakup/[...path]/route");
    expect((await GET(new Request("http://localhost/api/speakup/admin"), context(["admin"]))).status).toBe(404);
    expect((await POST(new Request("http://localhost/api/speakup/recordings/r1", { method: "POST" }), context(["recordings", "r1"]))).status).toBe(404);
    expect(state.invocations).toHaveLength(0);
  });

  it("returns a safe error when the development Lambda cannot be invoked", async () => {
    state.failInvocation = true;
    const { GET } = await import("@/app/api/speakup/[...path]/route");
    const result = await GET(new Request("http://localhost/api/speakup/projects"), context(["projects"]));
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ message: "Guest API request failed" });
  });
});
