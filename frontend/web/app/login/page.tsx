import Form from "next/form";
import { PageShell } from "@/components/PageHeading";
import { buttonClass } from "@/components/Button";
import { Mascot } from "@/components/Mascot";

export const metadata = { title: "Sign in · SpeakUp" };

// Demo only: "Sign in" goes to the home page without checking anything.
// When connected, this signs in with Cognito (COGNITO_USER_POOL_ID and
// COGNITO_USER_POOL_CLIENT_ID in .env.development.example). The JWT it returns
// is sent as "Authorization: Bearer <token>" on every API call; see lib/api.ts.
export default function LoginPage() {
  return (
    <PageShell>
      <div data-surface="dark" className="relative mx-auto mt-24 flex w-full max-w-md flex-col gap-6 rounded-3xl border-2 border-outline bg-night p-8 md:p-10">
        {/* The mascot stands on the top edge of the card. */}
        <Mascot pose="wave" flip className="pointer-events-none absolute -top-[106px] right-6 w-32" />
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs text-mint">WELCOME BACK</p>
          <h1 className="font-display text-4xl font-bold text-cream">Sign in</h1>
          <p className="text-sm text-cream/80">Your recordings are private to your account.</p>
        </div>
        <Form action="/" className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 font-mono text-xs text-mint">
            EMAIL
            <input
              type="email"
              name="email"
              autoComplete="email"
              className="rounded-xl border-2 border-outline bg-cream px-3 py-2.5 font-sans text-base text-night"
            />
          </label>
          <label className="flex flex-col gap-1.5 font-mono text-xs text-mint">
            PASSWORD
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              className="rounded-xl border-2 border-outline bg-cream px-3 py-2.5 font-sans text-base text-night"
            />
          </label>
          <button type="submit" className={`${buttonClass("accent")} mt-2`}>
            Sign in
          </button>
        </Form>
        <p className="font-mono text-xs text-peach">DEMO: NOT CONNECTED TO COGNITO YET</p>
      </div>
    </PageShell>
  );
}
