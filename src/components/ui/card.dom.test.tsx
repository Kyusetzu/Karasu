import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, cardClass } from "./card";

/** The three panels a page is built from, so a row, a block and a well look the same wherever they appear. */
describe("Card", () => {
  it("is raised by default: the wash, the catch-light and room to breathe", () => {
    render(<Card>Body</Card>);
    expect(screen.getByText("Body")).toHaveClass("panel-wash", "panel-top", "rounded-panel", "bg-surface-900", "p-5");
  });

  it("draws a flat block without the wash and a sunken well a step darker, each with its own padding", () => {
    render(
      <>
        <Card variant="flat">Flat</Card>
        <Card variant="sunken">Well</Card>
      </>,
    );
    const flat = screen.getByText("Flat");
    expect(flat).toHaveClass("rounded-panel", "border-hair", "bg-surface-900", "p-4");
    expect(flat).not.toHaveClass("panel-wash");
    expect(screen.getByText("Well")).toHaveClass("rounded-control", "bg-surface-950", "p-3");
  });

  it("lets the caller's padding win and marks an interactive card on hover", () => {
    render(
      <Card variant="flat" interactive className="p-3">
        Row
      </Card>,
    );
    const row = screen.getByText("Row");
    expect(row).toHaveClass("p-3", "hover:border-surface-700");
    expect(row).not.toHaveClass("p-4");
  });

  it("spells the same classes for a card that has to be a link or a form", () => {
    expect(cardClass("flat", { interactive: true }).split(" ")).toEqual(
      expect.arrayContaining(["rounded-panel", "border-hair", "bg-surface-900", "transition-surface", "hover:border-surface-700"]),
    );
    expect(cardClass().split(" ")).toContain("panel-top");
  });
});
