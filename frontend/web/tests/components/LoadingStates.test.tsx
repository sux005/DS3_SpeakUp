import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeSkeleton, ReviewSkeleton } from "@/components/LoadingSkeleton";
import ProjectLoading from "@/app/projects/[projectId]/loading";
import NewAttemptLoading from "@/app/projects/[projectId]/new/loading";
import AnalyzingLoading from "@/app/recordings/[recordingId]/analyzing/loading";
import ResultsLoading from "@/app/recordings/[recordingId]/loading";

describe("loading states", () => {
  it.each([
    ["presentation", ProjectLoading, "Loading presentation"],
    ["recording form", NewAttemptLoading, "Loading recording form"],
    ["recording status", AnalyzingLoading, "Loading recording status"],
    ["results", ResultsLoading, "Loading results"],
  ])("announces the %s route as busy", (_name, Loading, label) => {
    const { container } = render(<Loading />);
    const status = screen.getByRole("status", { name: label });
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("main")?.contains(status)).toBe(true);
    expect(status.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it("announces the home and review placeholders without exposing decoration", () => {
    const { rerender } = render(<HomeSkeleton />);
    expect(screen.getByRole("status", { name: "Loading presentations" }).getAttribute("aria-busy")).toBe("true");
    rerender(<ReviewSkeleton />);
    const review = screen.getByRole("status", { name: "Loading review details" });
    expect(review.getAttribute("aria-busy")).toBe("true");
    expect(review.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });
});
