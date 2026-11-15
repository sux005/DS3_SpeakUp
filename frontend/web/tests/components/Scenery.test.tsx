import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Ammonite, Egg, FernCluster, Perch, SiteFooter, StrataDivider, ValleyBackdrop } from "@/components/Scenery";

describe("Scenery", () => {
  it("keeps every drawing out of the accessibility tree", () => {
    const { container } = render(
      <>
        <ValleyBackdrop className="scene" />
        <FernCluster />
        <FernCluster shape="low" className="low" />
        <Egg />
        <Egg cracked />
        <Ammonite />
      </>,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector(".scene")!.getAttribute("aria-hidden")).toBe("true");
    for (const svg of container.querySelectorAll(":scope > svg")) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("builds the valley from separate layers, with mist and fireflies as plain elements", () => {
    const { container } = render(<ValleyBackdrop />);
    expect(container.querySelectorAll("svg")).toHaveLength(2);
    expect(container.querySelectorAll("div.scene-mist")).toHaveLength(2);
    expect(container.querySelectorAll(".scene-fireflies span")).toHaveLength(6);
  });

  it("seats whatever it is given on the rock ledge", () => {
    render(<Perch className="w-40"><span>sitter</span></Perch>);
    expect(screen.getByText("sitter")).toBeTruthy();
  });

  it("sways each fern clump as a whole and offsets the low one", () => {
    const { container } = render(<><FernCluster /><FernCluster shape="low" /></>);
    const [tall, low] = container.querySelectorAll("svg.fern-sway");
    expect((tall as SVGElement).style.animationDelay).toBe("");
    expect((low as SVGElement).style.animationDelay).toBe("-2.4s");
  });

  it("only cracks the egg when asked", () => {
    const { container, rerender } = render(<Egg />);
    const whole = container.querySelectorAll("path").length;
    rerender(<Egg cracked />);
    expect(container.querySelectorAll("path").length).toBe(whole + 1);
  });

  it("renders the divider as a separator and the footer with its credit", () => {
    render(<><StrataDivider /><SiteFooter /></>);
    expect(screen.getByRole("separator")).toBeTruthy();
    expect(screen.getByRole("contentinfo").textContent).toContain("DS3 at UC San Diego");
  });
});
