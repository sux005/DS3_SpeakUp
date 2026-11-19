import Link from "next/link";
import { pageColumn } from "@/components/PageHeading";
import { ThemeToggle } from "@/components/ThemeToggle";

export function SiteNav() {
  return (
    <header className="border-b-2 border-line">
      <div className={`${pageColumn} flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 md:py-4`}>
        <Link href="/" className="font-display text-[28px] font-bold leading-none tracking-tight text-ink">
          SpeakUp
        </Link>
        {/* On phones the toggle sits beside the logo and the links take their own row. */}
        <div className="contents sm:flex sm:flex-wrap sm:items-center sm:gap-7">
          <nav className="order-3 flex basis-full flex-wrap items-center gap-x-6 text-sm font-semibold tracking-wide sm:order-none sm:basis-auto sm:gap-7">
            <Link href="/" className="nav-link text-ink">MY PRESENTATIONS</Link>
            <Link href="/rubric" className="nav-link text-ink">RUBRIC</Link>
            <Link href="/login" className="nav-link text-muted">SIGN IN (DEMO)</Link>
          </nav>
          <span className="order-2 flex sm:order-none"><ThemeToggle /></span>
        </div>
      </div>
    </header>
  );
}
