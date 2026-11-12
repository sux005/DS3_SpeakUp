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
      className="relative inline-flex h-11 w-[92px] shrink-0 cursor-pointer items-center justify-between rounded-full border border-line bg-pale px-3 text-teal transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-peach dark:border-night-line dark:bg-night-soft"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span aria-hidden="true" className="relative z-10 text-lg">☀</span>
      <span aria-hidden="true" className="relative z-10 text-lg">☾</span>
      <span aria-hidden="true" className="absolute left-1 top-1 h-[34px] w-[34px] rounded-full bg-cream shadow-sm transition-transform duration-300 motion-reduce:transition-none dark:translate-x-12 dark:bg-peach" />
    </button>
  );
}
