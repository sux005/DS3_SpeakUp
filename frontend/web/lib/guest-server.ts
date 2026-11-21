import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const GUEST_COOKIE = "speakup_guest_session";

const guestModeEnabled = () => process.env.SPEAKUP_DEV_GUEST_MODE === "1" && process.env.NODE_ENV !== "production";
const processSecret = randomBytes(32).toString("base64url");
const secret = () => process.env.SPEAKUP_DEV_GUEST_SECRET || processSecret;

function sign(id: string) {
  return createHmac("sha256", secret()).update(id).digest("base64url");
}

function valid(value: string | undefined): value is string {
  if (!value) return false;
  const [id, signature] = value.split(".");
  if (!id || !signature || !/^[0-9a-f-]{36}$/.test(id)) return false;
  const expected = Buffer.from(sign(id));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function guestMode() {
  return guestModeEnabled();
}

export async function getOrCreateGuestId() {
  if (!guestModeEnabled()) return null;
  const jar = await cookies();
  const current = jar.get(GUEST_COOKIE)?.value;
  if (valid(current)) return current.split(".")[0];
  const id = randomUUID();
  jar.set(GUEST_COOKIE, `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return id;
}

export function guestCookieValue(id: string) {
  return `${id}.${sign(id)}`;
}

export function routeFor(segments: string[]) {
  let decoded: string[];
  try { decoded = segments.map((segment) => decodeURIComponent(segment)); } catch { return null; }
  if (decoded.length === 1 && decoded[0] === "projects") return { route: "/projects", pathParameters: {} };
  if (decoded.length === 1 && decoded[0] === "examples") return { route: "/examples", pathParameters: {} };
  if (decoded.length >= 2 && decoded.length <= 3 && decoded[0] === "examples") {
    const route = decoded.length === 2 ? "/examples/{exampleId}" : `/examples/{exampleId}/${decoded[2]}`;
    if (["/examples/{exampleId}", "/examples/{exampleId}/review", "/examples/{exampleId}/analysis", "/examples/{exampleId}/download"].includes(route)) {
      return { route, pathParameters: { exampleId: decoded[1] } };
    }
  }
  if (decoded.length === 1 && decoded[0] === "uploads") return { route: "/uploads", pathParameters: {} };
  if (decoded.length === 2 && decoded[0] === "account" && decoded[1] === "limits") return { route: "/account/limits", pathParameters: {} };
  if (decoded.length === 3 && decoded[0] === "projects" && decoded[2] === "recordings") return { route: "/projects/{projectId}/recordings", pathParameters: { projectId: decoded[1] } };
  if (decoded.length === 2 && decoded[0] === "recordings") return { route: "/recordings/{recordingId}", pathParameters: { recordingId: decoded[1] } };
  if (decoded.length === 3 && decoded[0] === "recordings" && decoded[2] === "review") return { route: "/recordings/{recordingId}/review", pathParameters: { recordingId: decoded[1] } };
  if (decoded.length === 4 && decoded[0] === "recordings" && decoded[2] === "artifacts") return { route: "/recordings/{recordingId}/artifacts/{artifactType}", pathParameters: { recordingId: decoded[1], artifactType: decoded[3] } };
  if (decoded.length === 3 && decoded[0] === "recordings" && decoded[2] === "download") return { route: "/recordings/{recordingId}/download", pathParameters: { recordingId: decoded[1] } };
  return null;
}

export function allowed(method: string, route: string) {
  const reads = new Set(["/projects", "/examples", "/examples/{exampleId}", "/examples/{exampleId}/review", "/examples/{exampleId}/analysis", "/examples/{exampleId}/download", "/account/limits", "/projects/{projectId}/recordings", "/recordings/{recordingId}", "/recordings/{recordingId}/review", "/recordings/{recordingId}/artifacts/{artifactType}", "/recordings/{recordingId}/download"]);
  return method === "GET" ? reads.has(route) : method === "POST" && new Set(["/projects", "/uploads"]).has(route);
}
