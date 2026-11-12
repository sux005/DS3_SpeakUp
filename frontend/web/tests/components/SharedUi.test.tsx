import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, ButtonLink } from "@/components/Button";
import { PageHeading, PageShell } from "@/components/PageHeading";
import { SiteNav } from "@/components/SiteNav";

describe("shared UI components", () => {
  it("renders Button variants as type=button and forwards interaction props", () => {
    const onClick = vi.fn();
    render(<Button variant="accent" aria-label="save" onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "save" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("bg-peach");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders ButtonLink with its href and secondary styling", () => {
    render(<ButtonLink href="/projects/demo" variant="secondary">Open</ButtonLink>);
    const link = screen.getByRole("link", { name: "Open" });
    expect(link.getAttribute("href")).toBe("/projects/demo");
    expect(link.className).toContain("bg-pale");
  });

  it("renders PageShell and PageHeading with optional back arrow and React title content", () => {
    const { rerender } = render(
      <PageShell>
        <PageHeading crumb="PROJECT" crumbHref="/" title={<span>Animated title</span>} subtitle="A subtitle" />
      </PageShell>,
    );
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Animated title" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "← PROJECT" }).getAttribute("href")).toBe("/");
    expect(screen.getByText("A subtitle")).toBeTruthy();

    rerender(<PageHeading crumb="STATUS" title="No link" subtitle="Plain crumb" showBackArrow={false} />);
    expect(screen.queryByRole("link", { name: /STATUS/ })).toBeNull();
    expect(screen.getByText("STATUS")).toBeTruthy();
  });

  it("exposes site navigation links and keeps the theme switch available", () => {
    render(<SiteNav />);
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("link", { name: "speakup" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "MY PRESENTATIONS" }).getAttribute("href")).toBe("/");
    expect(screen.getByText("DEMO / JAMES")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Dark mode" })).toBeTruthy();
  });
});
