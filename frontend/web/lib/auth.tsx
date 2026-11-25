"use client";

// Sign-in with the Cognito user pool from infra/speakup.yaml. See docs/sign-in-process.md.
// The sign-in form is a popup (components/SignInDialog.tsx) that any page can open with
// openSignIn(); the account button in the nav opens it too.
//
// Set these in frontend/web/.env.local (values are the stack outputs UserPoolId and
// UserPoolClientId; neither is a secret):
//   NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-west-2_xxxxxxxxx
//   NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
// Without them the app runs as a guest, and the sign-in page says accounts are not set up.
//
// Passwords and codes go straight from the browser to Cognito (SRP). Nothing here sends
// them to the SpeakUp API or stores them. Google sign-in (lib/google-sign-in.ts) turns on
// when NEXT_PUBLIC_COGNITO_DOMAIN is also set.
// MFA is not handled yet: development leaves it optional, production requires it.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AuthenticationDetails,
  CognitoAccessToken,
  CognitoIdToken,
  CognitoRefreshToken,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  CognitoUserSession,
} from "amazon-cognito-identity-js";
import { cognitoDomain, exchangeGoogleCode, goTo, googleAuthorizeUrl, hostedSignOutUrl } from "@/lib/google-sign-in";

/** `google` is true for people who signed in with Google instead of a password. */
export type AuthUser = { sub: string; email: string; google: boolean };

type AuthContextValue = {
  /** False when the Cognito env vars are missing: everyone is a guest. */
  configured: boolean;
  ready: boolean;
  user: AuthUser | null;
  signUp: (email: string, password: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** True when the "Continue with Google" button should show. */
  googleEnabled: boolean;
  /** Leave for Google's sign-in page. `next` is where to come back to afterwards. */
  startGoogleSignIn: (next: string) => Promise<void>;
  /** On /auth/callback: finish Google sign-in and return the same-site path to go to. */
  finishGoogleSignIn: (code: string, state: string) => Promise<string>;
  /** Current access token for "Authorization: Bearer", refreshed when needed. Null for guests. */
  getAccessToken: () => Promise<string | null>;
  /** Whether the sign-in popup is showing. */
  signInOpen: boolean;
  /** True when the popup was opened by an action that runs after sign-in (for example saving a take). */
  signInHasPendingAction: boolean;
  /** Show the sign-in popup. `after` runs once the person is signed in. */
  openSignIn: (after?: () => void) => void;
  closeSignIn: () => void;
};

// An error whose message is already written for people, shown as is.
export class AuthMessageError extends Error {}

// Thrown when the account exists but the email code was never entered.
export class NeedsConfirmationError extends AuthMessageError {
  constructor() {
    super("Check your email for a confirmation code.");
  }
}

export const PASSWORD_RULES = "At least 12 characters, with an uppercase letter, a lowercase letter, a number and a symbol.";

// Cognito error names mapped to plain messages. Sign-in errors stay neutral so the
// page never says whether an email has an account.
export function friendlyAuthError(error: unknown): string {
  if (error instanceof AuthMessageError) return error.message;
  const name = (error as { code?: string; name?: string } | null)?.code ?? (error as { name?: string } | null)?.name;
  switch (name) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return "Email or password is incorrect.";
    case "InvalidPasswordException":
      return `That password is too weak. ${PASSWORD_RULES}`;
    case "CodeMismatchException":
      return "That code is not right. Check the latest email and try again.";
    case "ExpiredCodeException":
      return "That code has expired. Send a new one.";
    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return "Too many attempts. Wait a few minutes and try again.";
    case "InvalidParameterException":
      return "Check the email address and try again.";
    default:
      return "Something went wrong. Try again.";
  }
}

const poolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? "";
const clientId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID ?? "";

function createPool(): CognitoUserPool | null {
  if (!poolId || !clientId) return null;
  try {
    return new CognitoUserPool({ UserPoolId: poolId, ClientId: clientId });
  } catch {
    // A malformed pool ID should leave the app usable as a guest.
    return null;
  }
}

function userFromSession(session: CognitoUserSession): AuthUser {
  const claims = session.getIdToken().decodePayload();
  const identities = Array.isArray(claims.identities) ? (claims.identities as Array<{ providerName?: string }>) : [];
  return {
    sub: String(claims.sub),
    email: String(claims.email ?? ""),
    google: identities.some((identity) => identity.providerName === "Google"),
  };
}

function currentSession(user: CognitoUser) {
  return new Promise<CognitoUserSession>((resolve, reject) => {
    user.getSession((error: Error | null, session: CognitoUserSession | null) => {
      if (error || !session) reject(error ?? new Error("No session"));
      else resolve(session);
    });
  });
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const pool = useMemo(() => createPool(), []);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(!pool);
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInHasPendingAction, setSignInHasPendingAction] = useState(false);
  const afterSignIn = useRef<(() => void) | undefined>(undefined);

  // Restore a saved session on load. getSession refreshes an expired access token.
  useEffect(() => {
    const saved = pool?.getCurrentUser();
    if (!saved) return;
    let cancelled = false;
    currentSession(saved)
      .then((session) => !cancelled && session.isValid() && setUser(userFromSession(session)))
      .catch(() => undefined)
      .finally(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [pool]);

  // Nobody saved: ready straight away.
  useEffect(() => {
    if (pool && !pool.getCurrentUser()) queueMicrotask(() => setReady(true));
  }, [pool]);

  const cognitoUser = useCallback(
    (email: string) => {
      if (!pool) throw new Error("Accounts are not set up");
      return new CognitoUser({ Username: email.trim().toLowerCase(), Pool: pool });
    },
    [pool],
  );

  const signUp = useCallback(
    (email: string, password: string) =>
      new Promise<void>((resolve, reject) => {
        if (!pool) return reject(new Error("Accounts are not set up"));
        const address = email.trim().toLowerCase();
        pool.signUp(address, password, [new CognitoUserAttribute({ Name: "email", Value: address })], [], (error) =>
          error ? reject(error) : resolve(),
        );
      }),
    [pool],
  );

  const confirmSignUp = useCallback(
    (email: string, code: string) =>
      new Promise<void>((resolve, reject) => {
        cognitoUser(email).confirmRegistration(code.trim(), true, (error) => (error ? reject(error) : resolve()));
      }),
    [cognitoUser],
  );

  const resendCode = useCallback(
    (email: string) =>
      new Promise<void>((resolve, reject) => {
        cognitoUser(email).resendConfirmationCode((error) => (error ? reject(error) : resolve()));
      }),
    [cognitoUser],
  );

  const signIn = useCallback(
    (email: string, password: string) =>
      new Promise<void>((resolve, reject) => {
        const target = cognitoUser(email);
        const details = new AuthenticationDetails({ Username: email.trim().toLowerCase(), Password: password });
        target.authenticateUser(details, {
          onSuccess: (session) => {
            setUser(userFromSession(session));
            setSignInOpen(false);
            const after = afterSignIn.current;
            afterSignIn.current = undefined;
            resolve();
            after?.();
          },
          onFailure: (error: { code?: string; name?: string }) =>
            reject(error?.code === "UserNotConfirmedException" || error?.name === "UserNotConfirmedException" ? new NeedsConfirmationError() : error),
          totpRequired: () => reject(new AuthMessageError("This account uses an authenticator app, which SpeakUp does not support yet.")),
          mfaRequired: () => reject(new AuthMessageError("This account needs a second sign-in step that SpeakUp does not support yet.")),
          newPasswordRequired: () => reject(new AuthMessageError("This account needs a new password. Reset it, then sign in.")),
        });
      }),
    [cognitoUser],
  );

  const signOut = useCallback(async () => {
    const saved = pool?.getCurrentUser();
    if (saved) {
      // Revokes the refresh token (the app client has token revocation on) and clears local tokens.
      await new Promise<void>((resolve) => saved.signOut(() => resolve()));
    }
    const wasGoogle = user?.google;
    setUser(null);
    // Google sign-in also leaves a session on Cognito's hosted pages. Ending it there means
    // the next "Continue with Google" asks again instead of signing the same person straight in.
    if (wasGoogle && cognitoDomain()) goTo(hostedSignOutUrl(clientId));
  }, [pool, user]);

  const startGoogleSignIn = useCallback(async (next: string) => {
    if (!pool || !cognitoDomain()) throw new Error("Accounts are not set up");
    goTo(await googleAuthorizeUrl(clientId, next));
  }, [pool]);

  const finishGoogleSignIn = useCallback(async (code: string, state: string) => {
    if (!pool) throw new Error("Accounts are not set up");
    const { tokens, next } = await exchangeGoogleCode(clientId, code, state);
    const session = new CognitoUserSession({
      IdToken: new CognitoIdToken({ IdToken: tokens.id_token }),
      AccessToken: new CognitoAccessToken({ AccessToken: tokens.access_token }),
      RefreshToken: new CognitoRefreshToken({ RefreshToken: tokens.refresh_token }),
    });
    // Saving the session through the library keeps one place for tokens, so restoring,
    // refreshing and signing out work the same as for password sign-in.
    const username = String(session.getIdToken().decodePayload()["cognito:username"] ?? "");
    new CognitoUser({ Username: username, Pool: pool }).setSignInUserSession(session);
    setUser(userFromSession(session));
    setSignInOpen(false);
    afterSignIn.current = undefined;
    return next;
  }, [pool]);

  const getAccessToken = useCallback(async () => {
    const saved = pool?.getCurrentUser();
    if (!saved) return null;
    try {
      return (await currentSession(saved)).getAccessToken().getJwtToken();
    } catch {
      setUser(null);
      return null;
    }
  }, [pool]);

  const openSignIn = useCallback((after?: () => void) => {
    afterSignIn.current = after;
    setSignInHasPendingAction(Boolean(after));
    setSignInOpen(true);
  }, []);

  const closeSignIn = useCallback(() => {
    afterSignIn.current = undefined;
    setSignInOpen(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: Boolean(pool), ready, user, signUp, confirmSignUp, resendCode, signIn, signOut, getAccessToken,
      signInOpen, signInHasPendingAction, openSignIn, closeSignIn, googleEnabled: Boolean(pool && cognitoDomain()), startGoogleSignIn, finishGoogleSignIn,
    }),
    [pool, ready, user, signUp, confirmSignUp, resendCode, signIn, signOut, getAccessToken, signInOpen, signInHasPendingAction, openSignIn, closeSignIn, startGoogleSignIn, finishGoogleSignIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const notConfigured = () => Promise.reject(new Error("Accounts are not set up"));

// Outside an AuthProvider (unit tests, or a page rendered on its own) everyone is a guest.
const guest: AuthContextValue = {
  configured: false,
  ready: true,
  user: null,
  signUp: notConfigured,
  confirmSignUp: notConfigured,
  resendCode: notConfigured,
  signIn: notConfigured,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  signInOpen: false,
  signInHasPendingAction: false,
  openSignIn: () => undefined,
  closeSignIn: () => undefined,
  googleEnabled: false,
  startGoogleSignIn: notConfigured,
  finishGoogleSignIn: notConfigured,
};

/**
 * Run `action` now if sign-in isn't needed, otherwise open the sign-in popup and run it
 * after the person signs in. Sign-in is needed only when accounts are set up.
 */
export function useRequireSignIn() {
  const { configured, user, openSignIn } = useAuth();
  return useCallback((action: () => void) => {
    if (!configured || user) action();
    else openSignIn(action);
  }, [configured, user, openSignIn]);
}

export function useAuth() {
  return useContext(AuthContext) ?? guest;
}
