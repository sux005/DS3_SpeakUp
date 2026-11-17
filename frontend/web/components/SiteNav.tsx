import Link from "next/link";
import { pageColumn } from "@/components/PageHeading";
import { ThemeToggle } from "@/components/ThemeToggle";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b-2 border-line bg-background">
      <div className={`${pageColumn} grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 py-3 md:py-4 sm:flex sm:flex-wrap sm:justify-between`}>
        <Link href="/" className="font-display text-[28px] font-bold leading-none tracking-tight text-ink">
          SpeakUp
        </Link>
        <nav className="col-span-2 row-start-2 flex flex-wrap items-center gap-x-6 text-sm font-semibold tracking-wide sm:order-2 sm:basis-auto sm:gap-7">
          <Link href="/" className="nav-link text-ink">MY PRESENTATIONS</Link>
          <Link href="/rubric" className="nav-link text-ink">RUBRIC</Link>
        </nav>
        <div className="justify-self-end sm:order-3"><ThemeToggle /></div>
      </div>
    </header>
  );
}
