import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { allowed, getOrCreateGuestId, guestMode, routeFor } from "@/lib/guest-server";

const run = promisify(execFile);
const functionName = () => process.env.SPEAKUP_DEV_API_LAMBDA ?? "speakup-dev-api";

async function invoke(event: Record<string, unknown>) {
  const directory = await mkdtemp(join(tmpdir(), "speakup-guest-"));
  const input = join(directory, "event.json");
  const output = join(directory, "response.json");
  try {
    await writeFile(input, JSON.stringify(event), "utf8");
    await run("aws", ["lambda", "invoke", "--function-name", functionName(), "--region", process.env.AWS_REGION ?? "us-east-2", "--profile", process.env.AWS_PROFILE ?? "speakup", "--cli-binary-format", "raw-in-base64-out", "--payload", `fileb://${input}`, output], { maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(await readFile(output, "utf8")) as { statusCode?: number; headers?: Record<string, string>; body?: string };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function handler(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!guestMode()) return NextResponse.json({ message: "Development guest mode is disabled" }, { status: 404 });
  const segments = (await params).path;
  if (segments.length === 1 && segments[0] === "session" && request.method === "GET") {
    const id = await getOrCreateGuestId();
    return NextResponse.json({ guest: Boolean(id) }, { headers: { "cache-control": "no-store" } });
  }
  const target = routeFor(segments);
  if (!target || !allowed(request.method, target.route)) return NextResponse.json({ message: "Unsupported guest API route" }, { status: 404 });
  const guestId = await getOrCreateGuestId();
  if (!guestId) return NextResponse.json({ message: "Guest session unavailable" }, { status: 403 });
  const url = new URL(request.url);
  const body = request.method === "GET" ? "{}" : await request.text();
  const event = {
    version: "2.0",
    routeKey: `${request.method} ${target.route}`,
    rawPath: target.route,
    body,
    pathParameters: target.pathParameters,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    requestContext: { requestId: crypto.randomUUID(), authorizer: { jwt: { claims: { sub: `guest-${guestId}` } } } },
  };
  try {
    const result = await invoke(event);
    const headers = new Headers(result.headers ?? {});
    headers.set("cache-control", "no-store");
    return new NextResponse(result.body ?? "{}", { status: result.statusCode ?? 502, headers });
  } catch {
    return NextResponse.json({ message: "Guest API request failed" }, { status: 502 });
  }
}

export const GET = handler;
export const POST = handler;
