import { describe, expect, it } from "vitest";
import { allowed, guestCookieValue, routeFor } from "@/lib/guest-server";

describe("development guest API boundary", () => {
  it("maps only the owner-scoped API routes", () => {
    expect(routeFor(["projects"])).toEqual({ route: "/projects", pathParameters: {} });
    expect(routeFor(["projects", "p1", "recordings"])).toEqual({
      route: "/projects/{projectId}/recordings", pathParameters: { projectId: "p1" },
    });
    expect(routeFor(["recordings", "r1", "review"])).toEqual({
      route: "/recordings/{recordingId}/review", pathParameters: { recordingId: "r1" },
    });
    expect(routeFor(["admin", "users"])).toBeNull();
  });

  it("allows reads plus only project and upload writes", () => {
    expect(allowed("GET", "/recordings/{recordingId}/review")).toBe(true);
    expect(allowed("POST", "/projects")).toBe(true);
    expect(allowed("POST", "/uploads")).toBe(true);
    expect(allowed("DELETE", "/recordings/{recordingId}")).toBe(false);
    expect(allowed("POST", "/recordings/{recordingId}/process")).toBe(false);
  });

  it("creates a signed opaque cookie value without exposing the secret", () => {
    const value = guestCookieValue("00000000-0000-4000-8000-000000000000");
    expect(value).toMatch(/^00000000-0000-4000-8000-000000000000\.[A-Za-z0-9_-]+$/);
    expect(value).not.toContain("speakup-local-development-secret");
  });
});
