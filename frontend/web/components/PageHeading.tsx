import Link from "next/link";
import type { ReactNode } from "react";

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col items-start gap-8 px-4 py-10 md:p-16">
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
    <div className="flex flex-col gap-2.5">
      {crumbHref ? (
        <Link href={crumbHref} className="font-mono text-xs text-teal">
          {showBackArrow && "← "}{crumb}
        </Link>
      ) : (
        <p className="font-mono text-xs text-teal">{crumb}</p>
      )}
      <h1 className="font-display text-4xl font-bold text-ink md:text-5xl">{title}</h1>
      <p className="text-base text-muted">{subtitle}</p>
    </div>
  );
}
