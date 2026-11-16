import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = "light";
    window.localStorage.clear();
  });

  afterEach(() => vi.restoreAllMocks());

  it("toggles theme, accessible state, label, and persistence", () => {
    render(<ThemeToggle />);
    const toggle = screen.getByRole("switch", { name: "Dark mode" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.getAttribute("title")).toBe("Switch to light mode");
    expect(window.localStorage.getItem("speakup-theme")).toBe("dark");
    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("speakup-theme")).toBe("light");
  });

  it("responds to theme changes made by another control", () => {
    render(<ThemeToggle />);
    const toggle = screen.getByRole("switch", { name: "Dark mode" });
    act(() => {
      document.documentElement.dataset.theme = "dark";
      window.dispatchEvent(new Event("speakup-theme-change"));
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("keeps the visual switch working when storage is unavailable", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("switch", { name: "Dark mode" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
