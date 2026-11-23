import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the Cognito library: one fake user pool whose behavior each test sets.
const cognito = vi.hoisted(() => {
  const session = (sub = "user-1", email = "pat@example.com", valid = true) => ({
    isValid: () => valid,
    getIdToken: () => ({ decodePayload: () => ({ sub, email }) }),
    getAccessToken: () => ({ getJwtToken: () => `access-${sub}` }),
  });
  const state = {
    saved: null as null | { getSession: (cb: (error: Error | null, s: unknown) => void) => void; signOut: (cb: () => void) => void },
    signUpError: null as unknown,
    confirmError: null as unknown,
    resendError: null as unknown,
    authOutcome: "success" as "success" | "failure" | "totpRequired" | "mfaRequired" | "newPasswordRequired",
    authError: null as unknown,
    poolThrows: false,
    calls: [] as Array<[string, ...unknown[]]>,
  };
  return { state, session };
});

vi.mock("amazon-cognito-identity-js", () => {
  const { state, session } = cognito;
  class CognitoUserPool {
    constructor(config: { UserPoolId: string; ClientId: string }) {
      if (cognito.state.poolThrows) throw new Error("bad pool id");
      state.calls.push(["pool", config.UserPoolId, config.ClientId]);
    }
    getCurrentUser() {
      return state.saved;
    }
    signUp(email: string, password: string, attributes: Array<{ Name: string; Value: string }>, _validation: unknown, cb: (error: unknown) => void) {
      state.calls.push(["signUp", email, password, attributes.map((attribute) => `${attribute.Name}=${attribute.Value}`)]);
      cb(state.signUpError);
    }
  }
  class CognitoUser {
    username: string;
    constructor({ Username }: { Username: string }) {
      this.username = Username;
    }
    confirmRegistration(code: string, _force: boolean, cb: (error: unknown) => void) {
      state.calls.push(["confirm", this.username, code]);
      cb(state.confirmError);
    }
    resendConfirmationCode(cb: (error: unknown) => void) {
      state.calls.push(["resend", this.username]);
      cb(state.resendError);
    }
    authenticateUser(details: { Username: string }, callbacks: Record<string, (value?: unknown) => void>) {
      state.calls.push(["auth", this.username, details.Username]);
      if (state.authOutcome === "success") callbacks.onSuccess(session());
      else if (state.authOutcome === "failure") callbacks.onFailure(state.authError);
      else callbacks[state.authOutcome]();
    }
  }
  class AuthenticationDetails {
    Username: string;
    constructor({ Username }: { Username: string }) {
      this.Username = Username;
    }
  }
  class CognitoUserAttribute {
    Name: string;
    Value: string;
    constructor({ Name, Value }: { Name: string; Value: string }) {
      this.Name = Name;
      this.Value = Value;
    }
  }
  return { CognitoUserPool, CognitoUser, AuthenticationDetails, CognitoUserAttribute };
});

type AuthModule = typeof import("@/lib/auth");

async function loadAuth(configured = true): Promise<AuthModule> {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_COGNITO_USER_POOL_ID", configured ? "us-west-2_abc123" : "");
  vi.stubEnv("NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID", configured ? "client123" : "");
  return import("@/lib/auth");
}

let latest: ReturnType<AuthModule["useAuth"]>;

async function renderAuth(auth: AuthModule) {
  function Probe() {
    latest = auth.useAuth();
    return <output data-testid="who">{latest.ready ? latest.user?.email ?? "guest" : "loading"}</output>;
  }
  render(<auth.AuthProvider><Probe /></auth.AuthProvider>);
  await waitFor(() => expect(screen.getByTestId("who").textContent).not.toBe("loading"));
}

beforeEach(() => {
  Object.assign(cognito.state, { saved: null, signUpError: null, confirmError: null, resendError: null, authOutcome: "success", authError: null, poolThrows: false, calls: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("auth helpers", () => {
  it("maps Cognito errors to plain, neutral messages", async () => {
    const { friendlyAuthError, AuthMessageError, NeedsConfirmationError, PASSWORD_RULES } = await loadAuth();
    expect(friendlyAuthError({ code: "NotAuthorizedException" })).toBe("Email or password is incorrect.");
    expect(friendlyAuthError({ name: "UserNotFoundException" })).toBe("Email or password is incorrect.");
    expect(friendlyAuthError({ code: "UsernameExistsException" })).toBe("Something went wrong. Try again.");
    expect(friendlyAuthError({ code: "InvalidPasswordException" })).toContain(PASSWORD_RULES);
    expect(friendlyAuthError({ code: "CodeMismatchException" })).toMatch(/code is not right/);
    expect(friendlyAuthError({ code: "ExpiredCodeException" })).toMatch(/expired/);
    expect(friendlyAuthError({ code: "LimitExceededException" })).toMatch(/Too many attempts/);
    expect(friendlyAuthError({ code: "InvalidParameterException" })).toMatch(/Check the email/);
    expect(friendlyAuthError(new AuthMessageError("Shown as is."))).toBe("Shown as is.");
    expect(friendlyAuthError(new NeedsConfirmationError())).toMatch(/confirmation code/);
    expect(friendlyAuthError(null)).toBe("Something went wrong. Try again.");
  });
});

describe("AuthProvider", () => {
  it("treats everyone as a guest without the Cognito settings, or outside the provider", async () => {
    const auth = await loadAuth(false);
    await renderAuth(auth);
    expect(latest.configured).toBe(false);
    expect(screen.getByTestId("who").textContent).toBe("guest");
    await expect(latest.signIn("a@b.co", "x")).rejects.toThrow("Accounts are not set up");
    await expect(latest.signUp("a@b.co", "x")).rejects.toThrow("Accounts are not set up");
    expect(await latest.getAccessToken()).toBeNull();
    await latest.signOut();
    cleanup();

    function Bare() {
      const value = auth.useAuth();
      return <output>{String(value.configured)}:{String(value.ready)}</output>;
    }
    render(<Bare />);
    expect(screen.getByText("false:true")).toBeTruthy();
  });

  it("falls back to guest when the pool settings are malformed", async () => {
    cognito.state.poolThrows = true;
    const auth = await loadAuth();
    await renderAuth(auth);
    expect(latest.configured).toBe(false);
  });

  it("signs up, confirms and signs in with a normalized email", async () => {
    const auth = await loadAuth();
    await renderAuth(auth);
    expect(latest.configured).toBe(true);
    await act(() => latest.signUp("  Pat@Example.com ", "Secret-Password-1"));
    await act(() => latest.confirmSignUp("pat@example.com", " 123456 "));
    await act(() => latest.resendCode("pat@example.com"));
    await act(() => latest.signIn("Pat@Example.com", "Secret-Password-1"));
    expect(cognito.state.calls).toEqual(expect.arrayContaining([
      ["signUp", "pat@example.com", "Secret-Password-1", ["email=pat@example.com"]],
      ["confirm", "pat@example.com", "123456"],
      ["resend", "pat@example.com"],
      ["auth", "pat@example.com", "pat@example.com"],
    ]));
    expect(screen.getByTestId("who").textContent).toBe("pat@example.com");
  });

  it("passes Cognito errors through and flags unconfirmed accounts", async () => {
    const auth = await loadAuth();
    await renderAuth(auth);
    cognito.state.signUpError = { code: "UsernameExistsException" };
    await expect(latest.signUp("a@b.co", "x")).rejects.toEqual({ code: "UsernameExistsException" });
    cognito.state.confirmError = { code: "CodeMismatchException" };
    await expect(latest.confirmSignUp("a@b.co", "1")).rejects.toEqual({ code: "CodeMismatchException" });
    cognito.state.resendError = { code: "LimitExceededException" };
    await expect(latest.resendCode("a@b.co")).rejects.toEqual({ code: "LimitExceededException" });
    cognito.state.authOutcome = "failure";
    cognito.state.authError = { code: "UserNotConfirmedException" };
    await expect(latest.signIn("a@b.co", "x")).rejects.toBeInstanceOf(auth.NeedsConfirmationError);
    cognito.state.authError = { name: "UserNotConfirmedException" };
    await expect(latest.signIn("a@b.co", "x")).rejects.toBeInstanceOf(auth.NeedsConfirmationError);
    cognito.state.authError = { code: "NotAuthorizedException" };
    await expect(latest.signIn("a@b.co", "x")).rejects.toEqual({ code: "NotAuthorizedException" });
    for (const outcome of ["totpRequired", "mfaRequired", "newPasswordRequired"] as const) {
      cognito.state.authOutcome = outcome;
      await expect(latest.signIn("a@b.co", "x")).rejects.toBeInstanceOf(auth.AuthMessageError);
    }
  });

  it("restores a saved session, hands out access tokens and signs out", async () => {
    const signOut = vi.fn((cb: () => void) => cb());
    cognito.state.saved = { getSession: (cb) => cb(null, cognito.session("user-9", "sam@example.com")), signOut };
    const auth = await loadAuth();
    await renderAuth(auth);
    expect(screen.getByTestId("who").textContent).toBe("sam@example.com");
    expect(await latest.getAccessToken()).toBe("access-user-9");
    await act(() => latest.signOut());
    expect(signOut).toHaveBeenCalled();
    expect(screen.getByTestId("who").textContent).toBe("guest");
  });

  it("drops an expired or broken saved session", async () => {
    cognito.state.saved = { getSession: (cb) => cb(new Error("expired"), null), signOut: vi.fn() };
    const auth = await loadAuth();
    await renderAuth(auth);
    expect(screen.getByTestId("who").textContent).toBe("guest");
    await act(async () => expect(await latest.getAccessToken()).toBeNull());
    cleanup();

    cognito.state.saved = { getSession: (cb) => cb(null, cognito.session("u", "e@x.co", false)), signOut: vi.fn() };
    await renderAuth(await loadAuth());
    expect(screen.getByTestId("who").textContent).toBe("guest");
  });

  it("runs the pending action after signing in from the popup", async () => {
    const auth = await loadAuth();
    let require: (action: () => void) => void = () => undefined;
    function Gate() {
      require = auth.useRequireSignIn();
      return null;
    }
    render(<auth.AuthProvider><Gate /></auth.AuthProvider>);
    await renderAuth(auth);
    const after = vi.fn();
    act(() => latest.openSignIn(after));
    expect(latest.signInOpen).toBe(true);
    act(() => latest.closeSignIn());
    expect(latest.signInOpen).toBe(false);
    act(() => latest.openSignIn(after));
    await act(() => latest.signIn("pat@example.com", "Secret-Password-1"));
    expect(after).toHaveBeenCalledTimes(1);
    expect(latest.signInOpen).toBe(false);

    const action = vi.fn();
    act(() => require(action));
    expect(action).not.toHaveBeenCalled();
  });

  it("runs actions straight away when accounts aren't set up", async () => {
    const auth = await loadAuth(false);
    let require: (action: () => void) => void = () => undefined;
    function Gate() {
      require = auth.useRequireSignIn();
      return null;
    }
    function Bare() {
      const value = auth.useAuth();
      value.openSignIn();
      value.closeSignIn();
      return <output>{String(value.signInOpen)}</output>;
    }
    render(<><Gate /><Bare /></>);
    expect(screen.getByText("false")).toBeTruthy();
    const action = vi.fn();
    require(action);
    expect(action).toHaveBeenCalled();
    cleanup();
    await renderAuth(auth);
    latest.openSignIn();
    latest.closeSignIn();
    expect(latest.signInOpen).toBe(false);
  });
});
