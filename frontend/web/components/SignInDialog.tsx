"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { buttonClass } from "@/components/Button";
import { NeedsConfirmationError, PASSWORD_RULES, friendlyAuthError, useAuth } from "@/lib/auth";

type Mode = "signin" | "signup" | "confirm";

const field = "rounded-xl border-2 border-outline bg-cream px-3 py-2.5 text-base font-normal text-night";
const fieldLabel = "flex flex-col gap-1.5 text-sm font-semibold text-mint";
const textButton = "cursor-pointer font-semibold text-mint underline underline-offset-4 disabled:opacity-60";

// The sign-in popup: sign in, create an account, or enter the emailed code.
// Opened from the account button in the nav, or by any action that needs an account.
export function SignInDialog() {
  const { signIn, signUp, confirmSignUp, resendCode, closeSignIn } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  // Focus the first field, close on Escape, and give focus back to whatever opened the popup.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSignIn();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [closeSignIn]);

  function switchMode(target: Mode) {
    setMode(target);
    setError(null);
    setNotice(null);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      if (caught instanceof NeedsConfirmationError) {
        setMode("confirm");
        setNotice("Your account isn’t confirmed yet. Enter the code we emailed you.");
      } else {
        setError(friendlyAuthError(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "signin") {
      void run(() => signIn(email, password));
    } else if (mode === "signup") {
      void run(async () => {
        await signUp(email, password);
        setMode("confirm");
        setNotice(`We sent a code to ${email.trim()}. Enter it below to finish.`);
      });
    } else {
      void run(async () => {
        await confirmSignUp(email, code);
        // The password is still in the form, so sign in right away instead of asking again.
        await signIn(email, password);
      });
    }
  }

  const heading = mode === "signin" ? "Sign in" : mode === "signup" ? "Create an account" : "Confirm your email";
  const submitLabel = mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Confirm";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-night/60 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeSignIn();
    }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="sign-in-title" data-surface="dark"
        className="relative flex w-full max-w-md flex-col gap-5 rounded-3xl border-2 border-outline bg-night p-7 md:p-8">
        <button type="button" aria-label="Close" onClick={closeSignIn}
          className="absolute top-4 right-4 cursor-pointer rounded-full px-2 text-2xl leading-none text-cream/80 hover:text-cream">
          ×
        </button>
        <div className="flex flex-col gap-2 pr-6">
          <h2 id="sign-in-title" className="font-display text-3xl font-bold text-cream">{heading}</h2>
          <p className="text-[16px] text-cream/85">
            {mode === "confirm" ? "Check your inbox for a 6-digit code." : "An account keeps your recordings and scores so you can track your progress."}
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className={fieldLabel}>
            Email
            <input type="email" required autoComplete="email" value={email} readOnly={mode === "confirm"}
              onChange={(event) => setEmail(event.target.value)} className={field} />
          </label>
          {mode !== "confirm" && (
            <label className={fieldLabel}>
              Password
              <input type="password" required autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={mode === "signup" ? 12 : undefined} value={password}
                onChange={(event) => setPassword(event.target.value)} className={field} />
              {mode === "signup" && <span className="font-normal text-cream/75">{PASSWORD_RULES}</span>}
            </label>
          )}
          {mode === "confirm" && (
            <label className={fieldLabel}>
              Confirmation code
              <input inputMode="numeric" required autoComplete="one-time-code" value={code}
                onChange={(event) => setCode(event.target.value)} className={field} />
            </label>
          )}
          {notice && <p className="text-[15px] text-mint" role="status">{notice}</p>}
          {error && <p className="text-[15px] font-semibold text-peach" role="alert">{error}</p>}
          <button type="submit" disabled={busy} className={`${buttonClass("primary")} mt-1 disabled:opacity-60`}>
            {busy ? "Please wait…" : submitLabel}
          </button>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[15px]">
            {mode === "signin" && (
              <button type="button" className={textButton} onClick={() => switchMode("signup")}>New here? Create an account</button>
            )}
            {mode === "signup" && (
              <button type="button" className={textButton} onClick={() => switchMode("signin")}>Have an account? Sign in</button>
            )}
            {mode === "confirm" && (
              <button type="button" disabled={busy} className={textButton}
                onClick={() => void run(async () => { await resendCode(email); setNotice("We sent a new code."); })}>
                Send a new code
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
