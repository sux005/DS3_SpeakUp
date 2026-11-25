"use client";

import { SignInDialog } from "@/components/SignInDialog";
import { useAuth } from "@/lib/auth";

const linkButton = "nav-link cursor-pointer text-sm font-semibold tracking-wide text-ink";

// The nav's corner account control: "SIGN IN" for guests, the email and "SIGN OUT"
// once signed in. It also hosts the sign-in popup, which other pages open with
// openSignIn(). Hidden when accounts aren't set up on this site.
export function AccountButton() {
  const { configured, ready, user, signInOpen, openSignIn, signOut } = useAuth();
  if (!configured || !ready) return null;

  return (
    <>
      {user ? (
        <div className="flex items-center gap-3">
          <span className="hidden max-w-[16rem] truncate text-sm text-muted md:inline" title={user.email}>{user.email}</span>
          <button type="button" className={linkButton} onClick={() => void signOut()}>SIGN OUT</button>
        </div>
      ) : (
        <button type="button" className={linkButton} onClick={() => openSignIn()}>SIGN IN</button>
      )}
      {signInOpen && !user && <SignInDialog />}
    </>
  );
}
