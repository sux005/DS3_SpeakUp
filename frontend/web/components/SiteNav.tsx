import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export function SiteNav() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-4 py-6 md:px-8 md:py-8">
      <Link href="/" className="font-display text-[27px] font-bold text-ink">
        SpeakUp
      </Link>
      <div className="flex flex-wrap items-center gap-4 sm:gap-8">
        <nav className="flex flex-wrap items-center gap-4 font-mono text-xs sm:gap-8">
          <Link href="/" className="text-teal">MY PRESENTATIONS</Link>
          <Link href="/rubric" className="text-teal">RUBRIC</Link>
          <Link href="/login" className="text-muted">SIGN IN (DEMO)</Link>
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
