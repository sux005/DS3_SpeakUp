import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// One fake account state that every component under test reads through useAuth().
const auth = vi.hoisted(() => ({
  value: {
    configured: true,
    ready: true,
    user: null as null | { sub: string; email: string },
    signInOpen: false,
    signUp: vi.fn(),
    confirmSignUp: vi.fn(),
    resendCode: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    getAccessToken: vi.fn(),
    openSignIn: vi.fn(),
    closeSignIn: vi.fn(),
  },
}));

const api = vi.hoisted(() => ({
  getProjects: vi.fn(),
  getExamples: vi.fn(),
  getProjectRecordings: vi.fn(),
  getAccountLimits: vi.fn(),
}));

vi.mock("@/lib/auth", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/auth")>();
  return {
    ...actual,
    useAuth: () => auth.value,
    useRequireSignIn: () => (action: () => void) => (auth.value.configured && !auth.value.user ? auth.value.openSignIn(action) : action()),
  };
});
vi.mock("@/lib/demo-store", () => ({ useDemoStore: () => ({ projects: [], recordings: [], reviews: {}, audioUrls: {}, ready: true, limits: {} }) }));
vi.mock("@/lib/api", () => ({
  EXAMPLE_PROJECT_ID: "example-project",
  isExampleRecording: () => false,
  ApiError: class ApiError extends Error { constructor(public status: number, public code: string | undefined, message: string) { super(message); } },
  ...api,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => createElement("img", { ...props, alt: String(props.alt ?? "") }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SPEAKUP_API_URL", "https://api.example.test");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  Object.assign(auth.value, { configured: true, ready: true, user: null, signInOpen: false });
  for (const fn of [...Object.values(api), auth.value.signUp, auth.value.confirmSignUp, auth.value.resendCode, auth.value.signIn, auth.value.signOut, auth.value.getAccessToken, auth.value.openSignIn, auth.value.closeSignIn]) fn.mockReset();
  api.getProjects.mockResolvedValue({ items: [{ project_id: "p1", project_title: "Mine", description: "", created_at: "2025-01-01T00:00:00Z" }] });
  api.getExamples.mockResolvedValue(null);
  api.getProjectRecordings.mockResolvedValue({ items: [] });
  api.getAccountLimits.mockResolvedValue({ max_audio_upload_bytes: 1000 });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function renderStore() {
  const { LiveProvider, useAppStore } = await import("@/lib/live-store");
  function Probe() {
    const store = useAppStore();
    return <output data-testid="state">{`${store.ready}:${store.projects.map((p) => p.project_title).join(",")}:${store.error ?? ""}`}</output>;
  }
  return render(<LiveProvider><Probe /></LiveProvider>);
}

describe("live store with accounts", () => {
  it("loads nothing while signed out", async () => {
    await renderStore();
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("true::"));
    expect(api.getProjects).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the signed-in person's access token and skips the guest bridge", async () => {
    auth.value.user = { sub: "user-1", email: "pat@example.com" };
    auth.value.getAccessToken.mockResolvedValue("access-1");
    await renderStore();
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("true:Mine:"));
    expect(api.getProjects).toHaveBeenCalledWith("access-1", undefined);
    expect(api.getAccountLimits).toHaveBeenCalledWith("access-1");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks to sign in again when the session has expired", async () => {
    auth.value.user = { sub: "user-1", email: "pat@example.com" };
    auth.value.getAccessToken.mockResolvedValue(null);
    await renderStore();
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("true::Sign in to load your presentations."));
  });

  it("waits for a saved session to be restored before loading", async () => {
    auth.value.ready = false;
    await renderStore();
    await act(async () => undefined);
    expect(screen.getByTestId("state").textContent).toBe("false::");
    expect(api.getProjects).not.toHaveBeenCalled();
  });
});

describe("account button and sign-in popup", () => {
  async function renderButton() {
    const { AccountButton } = await import("@/components/AccountButton");
    return render(<AccountButton />);
  }

  it("is hidden when accounts are not set up", async () => {
    auth.value.configured = false;
    const { container } = await renderButton();
    expect(container.textContent).toBe("");
  });

  it("opens the popup for guests and signs out for signed-in people", async () => {
    const view = await renderButton();
    fireEvent.click(screen.getByRole("button", { name: "SIGN IN" }));
    expect(auth.value.openSignIn).toHaveBeenCalled();
    view.unmount();

    auth.value.user = { sub: "user-1", email: "pat@example.com" };
    await renderButton();
    expect(screen.getByText("pat@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "SIGN OUT" }));
    expect(auth.value.signOut).toHaveBeenCalled();
  });

  it("signs in from the popup and shows neutral errors", async () => {
    auth.value.signInOpen = true;
    auth.value.signIn.mockRejectedValueOnce({ code: "NotAuthorizedException" }).mockResolvedValueOnce(undefined);
    await renderButton();
    expect(screen.getByRole("dialog", { name: "Sign in" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "pat@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Secret-Password-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Email or password is incorrect.");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(auth.value.signIn).toHaveBeenCalledTimes(2));
    expect(auth.value.signIn).toHaveBeenLastCalledWith("pat@example.com", "Secret-Password-1");
  });

  it("creates an account, confirms the emailed code and signs in", async () => {
    auth.value.signInOpen = true;
    auth.value.signUp.mockResolvedValue(undefined);
    auth.value.resendCode.mockResolvedValue(undefined);
    auth.value.confirmSignUp.mockResolvedValue(undefined);
    auth.value.signIn.mockResolvedValue(undefined);
    await renderButton();
    fireEvent.click(screen.getByRole("button", { name: "New here? Create an account" }));
    expect(screen.getByRole("dialog", { name: "Create an account" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "pat@example.com" } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "Secret-Password-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("dialog", { name: "Confirm your email" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("pat@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("We sent a new code."));
    fireEvent.change(screen.getByLabelText("Confirmation code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(auth.value.signIn).toHaveBeenCalledWith("pat@example.com", "Secret-Password-1"));
    expect(auth.value.confirmSignUp).toHaveBeenCalledWith("pat@example.com", "123456");
  });

  it("moves to the code step when the account was never confirmed", async () => {
    const { NeedsConfirmationError } = await import("@/lib/auth");
    auth.value.signInOpen = true;
    auth.value.signIn.mockRejectedValue(new NeedsConfirmationError());
    await renderButton();
    fireEvent.click(screen.getByRole("button", { name: "New here? Create an account" }));
    fireEvent.click(screen.getByRole("button", { name: "Have an account? Sign in" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "pat@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Secret-Password-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("dialog", { name: "Confirm your email" })).toBeTruthy();
  });

  it("closes on Escape, the close button and a click outside", async () => {
    auth.value.signInOpen = true;
    await renderButton();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(auth.value.closeSignIn).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(auth.value.closeSignIn).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(auth.value.closeSignIn).toHaveBeenCalledTimes(3);
  });
});

describe("home page", () => {
  it("asks guests to sign in before starting a presentation", async () => {
    vi.stubEnv("NEXT_PUBLIC_SPEAKUP_API_URL", "");
    const { default: Home } = await import("@/app/page");
    render(<Home />);
    expect(screen.getByText("Sign in to see your presentations.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "+ New presentation" }));
    expect(auth.value.openSignIn).toHaveBeenCalledWith(expect.any(Function));
    expect(screen.queryByText("Start with your audio")).toBeNull();
    // Once signed in, the popup runs the pending action and the form opens.
    act(() => auth.value.openSignIn.mock.calls[0][0]());
    expect(screen.getByText("Start with your audio")).toBeTruthy();
  });
});
