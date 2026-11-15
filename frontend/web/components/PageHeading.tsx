import Link from "next/link";
import type { ReactNode } from "react";

// Every page shares this column, and the nav and footer align to it.
export const pageColumn = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className={`${pageColumn} flex flex-col items-start gap-8 py-8 md:py-12`}>
      {children}
    </main>
  );
}

export function PageHeading({
  crumb,
  crumbHref,
  title,
  subtitle,
  showBackArrow = true,
}: {
  crumb: string;
  crumbHref?: string;
  title: ReactNode;
  subtitle: string;
  showBackArrow?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {crumbHref ? (
        <Link href={crumbHref} className="nav-link w-fit font-mono text-xs text-teal">
          {showBackArrow && "← "}{crumb}
        </Link>
      ) : (
        <p className="font-mono text-xs text-teal">{crumb}</p>
      )}
      <h1 className="font-display text-4xl font-bold tracking-tight break-words text-ink md:text-[44px] md:leading-[1.1]">{title}</h1>
      <p className="max-w-3xl text-[17px] text-muted">{subtitle}</p>
    </div>
  );
}
