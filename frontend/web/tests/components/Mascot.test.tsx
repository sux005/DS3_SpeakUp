import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ErrorPage from "@/app/error";
import NotFound from "@/app/not-found";
import { Mascot, type MascotState as MascotImage } from "@/components/Mascot";
import { MascotCoach } from "@/components/MascotCoach";
import { MascotState } from "@/components/MascotState";

const states: MascotImage[] = ["neutral", "recording", "results"];

describe("Mascot", () => {
  it.each(states)("shows the approved %s PNG as decoration by default", (state) => {
    const { container } = render(<Mascot state={state} />);
    const image = container.querySelector("img")!;
    expect(decodeURIComponent(image.getAttribute("src")!)).toContain(`/mascot/mascot-${state}.png`);
    expect(image.getAttribute("alt")).toBe("");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("defaults to the neutral pose and can be given a description", () => {
    const { container } = render(<Mascot alt="The SpeakUp dinosaur" />);
    expect(container.querySelector('[data-mascot="neutral"]')).toBeTruthy();
    expect(screen.getByRole("img", { name: "The SpeakUp dinosaur" })).toBeTruthy();
  });

  it("crops every pose to the same box so they share a size and a baseline", () => {
    const { container } = render(<>{states.map((state) => <Mascot key={state} state={state} />)}</>);
    const boxes = [...container.querySelectorAll<HTMLElement>("[data-mascot]")];
    expect(new Set(boxes.map((box) => box.style.aspectRatio)).size).toBe(1);
    expect(boxes[0].style.aspectRatio).toBe("909 / 1000");
  });

  it("mirrors the box, not the file, to face left", () => {
    const { container, rerender } = render(<Mascot />);
    expect(container.querySelector<HTMLElement>("[data-mascot]")!.style.transform).toBe("");
    rerender(<Mascot flip />);
    expect(container.querySelector<HTMLElement>("[data-mascot]")!.style.transform).toBe("scaleX(-1)");
  });
});

describe("MascotCoach", () => {
  it("shows the bubble text beside the given pose", () => {
    const { container } = render(<MascotCoach state="recording">Ready to record.</MascotCoach>);
    expect(screen.getByText("Ready to record.")).toBeTruthy();
    expect(container.querySelector('[data-mascot="recording"]')).toBeTruthy();
  });

  it("leaves the bubble out when there is nothing to say", () => {
    const { container } = render(<MascotCoach state="recording">{null}</MascotCoach>);
    expect(container.querySelector(".speech-bubble")).toBeNull();
  });
});

describe("MascotState", () => {
  it("renders a compact status row while busy", () => {
    render(<MascotState busy message="Loading…" />);
    expect(screen.getByRole("status").textContent).toBe("Loading…");
  });

  it("renders a panel with detail and actions", () => {
    render(
      <MascotState tone="error" message="Not found." detail="Nothing matches.">
        <button type="button">Go home</button>
      </MascotState>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Not found.")).toBeTruthy();
    expect(screen.getByText("Nothing matches.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go home" })).toBeTruthy();
  });

  it("keeps the neutral image for every tone and marks the state with a badge", () => {
    const { container, rerender } = render(<MascotState tone="error" message="Failed." />);
    expect(container.querySelector('[data-mascot="neutral"]')).toBeTruthy();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    rerender(<MascotState tone="loading" message="Working." />);
    expect(container.querySelector('[data-mascot="neutral"]')).toBeTruthy();
    expect(container.querySelector(".analyzing-dots")).toBeTruthy();
    rerender(<MascotState message="Nothing yet." />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector(".analyzing-dots")).toBeNull();
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
