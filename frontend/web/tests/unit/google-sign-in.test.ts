import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeGoogleCode, googleAuthorizeUrl, hostedSignOutUrl, safeNext } from "@/lib/google-sign-in";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_COGNITO_DOMAIN", "speakup-dev-1.auth.us-east-2.amazoncognito.com");
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("google sign-in helpers", () => {
  it("only follows same-site paths after sign-in", () => {
    expect(safeNext("/practice")).toBe("/practice");
    expect(safeNext("/practice?x=1#top")).toBe("/practice?x=1#top");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/\tevil")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });

  it("builds a PKCE authorize URL that goes straight to Google", async () => {
    const url = new URL(await googleAuthorizeUrl("client-1", "//evil.example"));
    expect(url.origin).toBe("https://speakup-dev-1.auth.us-east-2.amazoncognito.com");
    expect(url.pathname).toBe("/oauth2/authorize");
    const params = Object.fromEntries(url.searchParams);
    expect(params).toMatchObject({
      identity_provider: "Google",
      response_type: "code",
      client_id: "client-1",
      redirect_uri: `${window.location.origin}/auth/callback`,
      scope: "openid email profile",
      code_challenge_method: "S256",
    });
    const saved = JSON.parse(sessionStorage.getItem("speakup-google-sign-in")!);
    expect(saved.state).toBe(params.state);
    expect(saved.next).toBe("/");
    // The challenge is the SHA-256 of the saved verifier, base64url without padding.
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(saved.verifier)));
    const expected = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(params.code_challenge).toBe(expected);
  });

  it("trades the code for tokens once, with the saved verifier", async () => {
    const url = new URL(await googleAuthorizeUrl("client-1", "/practice"));
    const state = url.searchParams.get("state")!;
    const verifier = JSON.parse(sessionStorage.getItem("speakup-google-sign-in")!).verifier;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id_token: "i", access_token: "a", refresh_token: "r" })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(exchangeGoogleCode("client-1", "code-1", state)).resolves.toEqual({ tokens: { id_token: "i", access_token: "a", refresh_token: "r" }, next: "/practice" });
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("https://speakup-dev-1.auth.us-east-2.amazoncognito.com/oauth2/token");
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      grant_type: "authorization_code", client_id: "client-1", code: "code-1", redirect_uri: `${window.location.origin}/auth/callback`, code_verifier: verifier,
    });
    await expect(exchangeGoogleCode("client-1", "code-1", state)).rejects.toThrow(/expired/);
  });

  it("refuses a state this tab didn't start, and reports a failed exchange", async () => {
    await googleAuthorizeUrl("client-1", "/");
    await expect(exchangeGoogleCode("client-1", "code", "someone-elses-state")).rejects.toThrow(/expired/);
    const url = new URL(await googleAuthorizeUrl("client-1", "/"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 400 })));
    await expect(exchangeGoogleCode("client-1", "code", url.searchParams.get("state")!)).rejects.toThrow(/didn’t finish/);
  });

  it("points sign-out at Cognito's logout page with the site as the return address", () => {
    const url = new URL(hostedSignOutUrl("client-1"));
    expect(url.pathname).toBe("/logout");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("logout_uri")).toBe(`${window.location.origin}/`);
  });
});
