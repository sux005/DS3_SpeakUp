import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ErrorPage from "@/app/error";
import NotFound from "@/app/not-found";
import { Mascot, type MascotPose } from "@/components/Mascot";
import { MascotCoach } from "@/components/MascotCoach";
import { MascotState } from "@/components/MascotState";

const poses: MascotPose[] = ["wave", "cheer", "listen", "think", "celebrate", "oops", "sleep"];

describe("Mascot", () => {
  it.each(poses)("draws the %s pose as decoration by default", (pose) => {
    const { container } = render(<Mascot pose={pose} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("data-mascot")).toBe(pose);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("is announced as an image when it has a title", () => {
    render(<Mascot title="The SpeakUp dinosaur waving" />);
    expect(screen.getByRole("img", { name: "The SpeakUp dinosaur waving" })).toBeTruthy();
  });

  it("blinks only in poses with open eyes", () => {
    const { container, rerender } = render(<Mascot pose="wave" />);
    expect(container.querySelector(".mascot-eyes")).toBeTruthy();
    rerender(<Mascot pose="sleep" />);
    expect(container.querySelector(".mascot-eyes")).toBeNull();
  });

  it("can face left and can peek out of an egg", () => {
    const { container, rerender } = render(<Mascot flip />);
    expect(container.querySelector("svg > g")!.getAttribute("transform")).toContain("scale(-1 1)");
    rerender(<Mascot variant="egg" pose="sleep" />);
    expect(container.querySelector("svg > g")!.getAttribute("transform")).toBeNull();
    expect(container.querySelectorAll("ellipse").length).toBeGreaterThan(3);
  });
});

describe("MascotCoach", () => {
  it("shows what the mascot says next to the pose", () => {
    const { container } = render(<MascotCoach pose="listen">Keep going!</MascotCoach>);
    expect(screen.getByText("Keep going!")).toBeTruthy();
    expect(container.querySelector('[data-mascot="listen"]')).toBeTruthy();
  });
});

describe("MascotState", () => {
  it("renders a compact status row while busy", () => {
    render(<MascotState busy pose="think" message="Loading…" />);
    expect(screen.getByRole("status").textContent).toBe("Loading…");
  });

  it("renders a panel with detail and actions", () => {
    render(
      <MascotState pose="oops" message="Not found." detail="Nothing matches.">
        <button type="button">Go home</button>
      </MascotState>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Not found.")).toBeTruthy();
    expect(screen.getByText("Nothing matches.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go home" })).toBeTruthy();
  });

  it("leaves out detail and actions when there are none", () => {
    const { container } = render(<MascotState pose="wave" variant="egg" message="Nothing yet." />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});

describe("not-found and error pages", () => {
  it("offers a way back from a missing page", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "All presentations" }).getAttribute("href")).toBe("/");
  });

  it("lets the reader retry after an error", () => {
    const retry = vi.fn();
    render(<ErrorPage error={new Error("boom")} retry={retry} />);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "All presentations" }).getAttribute("href")).toBe("/");
  });
});
