import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export function SiteNav() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-4 py-6 md:px-8 md:py-8">
      <Link href="/" className="font-display text-[27px] font-bold text-ink">
        speakup
      </Link>
      <div className="flex items-center gap-4 sm:gap-8">
        <nav className="flex flex-wrap items-center gap-4 font-mono text-xs sm:gap-8">
          <Link href="/" className="text-teal">MY PRESENTATIONS</Link>
          <span className="text-muted">DEMO / JAMES</span>
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
