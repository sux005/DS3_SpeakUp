import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Ammonite, Egg, FernCluster, SceneFooter, StrataDivider, ValleyScene } from "@/components/Scenery";

describe("Scenery", () => {
  it("keeps every drawing out of the accessibility tree", () => {
    const { container } = render(
      <>
        <ValleyScene className="scene" />
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

  it("draws the valley as three layers so the mist can drift on its own", () => {
    const { container } = render(<ValleyScene />);
    expect(container.querySelectorAll("svg")).toHaveLength(3);
    expect(container.querySelectorAll("svg.scene-mist rect").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".scene-fireflies span")).toHaveLength(6);
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
    render(<><StrataDivider /><SceneFooter /></>);
    expect(screen.getByRole("separator")).toBeTruthy();
    expect(screen.getByRole("contentinfo").textContent).toContain("DS3 AT UC SAN DIEGO");
  });
});
