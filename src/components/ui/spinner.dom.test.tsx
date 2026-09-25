import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { RotateCw } from "lucide-react";
import { Spinner } from "./spinner";

/** The one place anything spins, so the spin is a prop and never a class a call site remembers to add. */
describe("Spinner", () => {
  it("turns while spinning and holds still otherwise", () => {
    const { container, rerender } = render(<Spinner spinning className="size-4" />);
    const svg = () => container.querySelector("svg")!;
    expect(svg()).toHaveClass("animate-spin", "size-4");
    rerender(<Spinner spinning={false} className="size-4" />);
    expect(svg()).not.toHaveClass("animate-spin");
    expect(svg()).toHaveClass("size-4");
  });

  it("draws the glyph it is given, hides it from assistive technology and passes other props through", () => {
    const { container } = render(<Spinner icon={RotateCw} style={{ opacity: 0.5 }} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveClass("lucide-rotate-cw");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveStyle({ opacity: "0.5" });
  });
});
