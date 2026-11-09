import Link from "next/link";

export function SiteNav() {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-line px-4 py-6 md:px-8 md:py-8">
      <Link href="/" className="font-display text-[27px] font-bold text-ink">
        speakup
      </Link>
      <nav className="flex gap-8 font-mono text-xs">
        <Link href="/" className="text-teal">
          MY PRESENTATIONS
        </Link>
        <span className="text-muted">DEMO / JAMES</span>
      </nav>
    </header>
  );
}
