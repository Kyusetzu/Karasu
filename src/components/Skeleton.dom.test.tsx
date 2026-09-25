import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Search } from "lucide-react";
import { Shimmer } from "./Skeleton";
import { EmptyState } from "./EmptyState";

/** A skeleton cell whose wait the stylesheet owns, and an empty state whose glyph sits on the icon scale. */
describe("Shimmer", () => {
  it("offsets its sweep through a custom property, so the inline style cannot also move the wait", () => {
    const { container } = render(<Shimmer index={3} />);
    const cell = container.firstElementChild as HTMLElement;
    expect(cell.style.getPropertyValue("--shimmer-offset")).toMatch(/ms$/);
    expect(cell.style.animationDelay).toBe("");
  });
});

describe("EmptyState", () => {
  it("draws a plain glyph at the empty-state size, hidden from the reader, above the title", () => {
    const { container } = render(<EmptyState icon={Search} title="Nothing matches" />);
    const glyph = container.querySelector("svg");
    expect(glyph).toHaveClass("size-8");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
  });
});
