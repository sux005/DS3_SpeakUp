import Form from "next/form";
import { PageShell } from "@/components/PageHeading";
import { buttonClass } from "@/components/Button";

export const metadata = { title: "Sign in · SpeakUp" };

// Demo only: "Sign in" goes to the home page without checking anything.
// When connected, this signs in with Cognito (COGNITO_USER_POOL_ID and
// COGNITO_USER_POOL_CLIENT_ID in .env.development.example). The JWT it returns
// is sent as "Authorization: Bearer <token>" on every API call; see lib/api.ts.
export default function LoginPage() {
  return (
    <PageShell>
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 bg-night p-8 md:p-10">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[11px] text-mint">WELCOME BACK</p>
          <h1 className="font-display text-4xl font-bold text-cream">Sign in</h1>
          <p className="text-sm text-cream/80">Your recordings are private to your account.</p>
        </div>
        <Form action="/" className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 font-mono text-[11px] text-mint">
            EMAIL
            <input
              type="email"
              name="email"
              autoComplete="email"
              className="rounded-md border border-night-line bg-cream px-3 py-2.5 font-sans text-base text-ink"
            />
          </label>
          <label className="flex flex-col gap-1.5 font-mono text-[11px] text-mint">
            PASSWORD
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              className="rounded-md border border-night-line bg-cream px-3 py-2.5 font-sans text-base text-ink"
            />
          </label>
          <button type="submit" className={`${buttonClass("accent")} mt-2`}>
            Sign in
          </button>
        </Form>
        <p className="font-mono text-[11px] text-peach">DEMO: NOT CONNECTED TO COGNITO YET</p>
      </div>
    </PageShell>
  );
}
