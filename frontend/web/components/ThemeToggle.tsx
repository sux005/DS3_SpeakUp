"use client";

import { useSyncExternalStore } from "react";

const themeEvent = "speakup-theme-change";

function subscribe(callback: () => void) {
  window.addEventListener(themeEvent, callback);
  return () => window.removeEventListener(themeEvent, callback);
}

function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  function toggle() {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("speakup-theme", next);
    } catch {
      // The switch still works when browser storage is unavailable.
    }
    window.dispatchEvent(new Event(themeEvent));
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      onClick={toggle}
      className="relative inline-flex h-11 w-[92px] shrink-0 cursor-pointer items-center justify-between rounded-full border-2 border-line bg-pale px-3 text-teal transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-peach dark:border-night-line dark:bg-night-soft"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="relative z-10 size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
        <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
      </svg>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="relative z-10 size-5" fill="currentColor">
        <path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a.7.7 0 0 0-.9-.9 9.9 9.9 0 1 0 12.6 12.6.7.7 0 0 0-.9-.9Z" />
      </svg>
      <span aria-hidden="true" className="absolute left-[3px] top-[3px] h-[34px] w-[34px] rounded-full bg-cream shadow-sm transition-transform duration-300 motion-reduce:transition-none dark:translate-x-12 dark:bg-peach" />
    </button>
  );
}
