import Form from "next/form";
import { PageShell } from "@/components/PageHeading";
import { buttonClass } from "@/components/Button";
import { Mascot } from "@/components/Mascot";
import { Perch, ValleyBackdrop } from "@/components/Scenery";

export const metadata = { title: "Sign in · SpeakUp" };

// Demo only: "Sign in" goes to the home page without checking anything.
// The fields have no name attribute on purpose, so nothing typed here is put
// in the URL or sent anywhere.
// When connected, this signs in with Cognito (COGNITO_USER_POOL_ID and
// COGNITO_USER_POOL_CLIENT_ID in .env.development.example). The JWT it returns
// is sent as "Authorization: Bearer <token>" on every API call; see lib/api.ts.
export default function LoginPage() {
  const field = "rounded-xl border-2 border-outline bg-cream px-3 py-2.5 text-base font-normal text-night";
  return (
    <PageShell>
      <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-3xl border-2 border-outline md:grid-cols-[1.1fr_1fr]">
        {/* The valley, with the mascot looking across at the form. Decoration only. */}
        <div className="relative isolate min-h-[250px] md:min-h-[520px]">
          <ValleyBackdrop className="-z-10" />
          <Perch className="absolute bottom-[40px] left-1/2 w-[270px] -translate-x-1/2 md:w-[440px]">
            <Mascot pose="wave" className="w-full" />
          </Perch>
        </div>

        <div data-surface="dark" className="flex flex-col justify-center gap-6 bg-night p-7 md:p-10">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-4xl font-bold text-cream">Sign in</h1>
            <p className="text-[17px] text-cream/85">Accounts aren’t connected yet. Choose Sign in to continue to the demo.</p>
          </div>
          <Form action="/" className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-mint">
              Email
              <input type="email" autoComplete="email" className={field} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-mint">
              Password
              <input type="password" autoComplete="current-password" className={field} />
            </label>
            <button type="submit" className={`${buttonClass("primary")} mt-2`}>
              Sign in
            </button>
          </Form>
          <div className="rounded-xl border-2 border-night-line bg-night-soft p-4">
            <p className="text-sm font-bold tracking-wide text-peach">DEMO: NOT CONNECTED TO COGNITO YET</p>
            <p className="mt-1 text-[15px] text-cream/85">Nothing you type here is checked, sent or saved. Your presentations stay in this browser.</p>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
