import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

export function SiteNav() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b-2 border-line px-4 py-4 md:px-8 md:py-5">
      <Link href="/" className="font-display text-[29px] font-bold leading-none tracking-tight text-ink">
        SpeakUp
      </Link>
      <div className="flex flex-wrap items-center gap-4 sm:gap-8">
        <nav className="flex flex-wrap items-center gap-4 font-mono text-xs sm:gap-8">
          <Link href="/" className="nav-link text-teal">MY PRESENTATIONS</Link>
          <Link href="/rubric" className="nav-link text-teal">RUBRIC</Link>
          <Link href="/login" className="nav-link text-muted">SIGN IN (DEMO)</Link>
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
