// Google sign-in through Cognito's hosted pages: the authorization code flow with PKCE.
// The browser goes to Cognito, Cognito sends it to Google and back to /auth/callback
// with a one-time code, and the callback page trades that code for Cognito tokens.
// There is no client secret in the browser; PKCE ties the code to this browser tab.
//
// Needs NEXT_PUBLIC_COGNITO_DOMAIN, the stack output CognitoDomain
// (for example speakup-dev-1a2b3c4d.auth.us-east-2.amazoncognito.com).

const STORAGE_KEY = "speakup-google-sign-in";

export type GoogleTokens = { id_token: string; access_token: string; refresh_token: string };

type Pending = { state: string; verifier: string; next: string };

export const cognitoDomain = () => process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? "";

/** Leave the site for Cognito or Google. Its own function so tests can watch it. */
export function goTo(url: string) {
  window.location.assign(url);
}

export const callbackUrl = () => `${window.location.origin}/auth/callback`;

// Only same-site paths, so a crafted link can't send people elsewhere after sign-in.
export function safeNext(next: string | null | undefined) {
  // Browsers read "\" as "/", so "/\evil.example" would leave the site; whitespace and backslashes are refused.
  return next && /^\/(?![/\\])[^\s\\]*$/.test(next) ? next : "/";
}

function base64Url(bytes: Uint8Array) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function challengeFor(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** The Cognito URL that starts Google sign-in. Saves the PKCE verifier and state for the callback. */
export async function googleAuthorizeUrl(clientId: string, next: string) {
  const pending: Pending = { state: randomString(), verifier: randomString(), next: safeNext(next) };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  const params = new URLSearchParams({
    identity_provider: "Google",
    response_type: "code",
    client_id: clientId,
    redirect_uri: callbackUrl(),
    scope: "openid email profile",
    state: pending.state,
    code_challenge: await challengeFor(pending.verifier),
    code_challenge_method: "S256",
  });
  return `https://${cognitoDomain()}/oauth2/authorize?${params}`;
}

/** Trade the code from the callback URL for tokens. Refuses a state this tab didn't start. */
export async function exchangeGoogleCode(clientId: string, code: string, state: string) {
  const saved = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  const pending = saved ? (JSON.parse(saved) as Pending) : null;
  if (!pending || pending.state !== state) throw new Error("This sign-in link has expired. Try signing in again.");
  const response = await fetch(`https://${cognitoDomain()}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: callbackUrl(),
      code_verifier: pending.verifier,
    }),
  });
  if (!response.ok) throw new Error("Google sign-in didn’t finish. Try again.");
  return { tokens: (await response.json()) as GoogleTokens, next: pending.next };
}

/** Cognito's sign-out page, which also ends the Cognito session Google sign-in left behind. */
export function hostedSignOutUrl(clientId: string) {
  const params = new URLSearchParams({ client_id: clientId, logout_uri: `${window.location.origin}/` });
  return `https://${cognitoDomain()}/logout?${params}`;
}
