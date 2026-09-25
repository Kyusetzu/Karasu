import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Badge } from "./badge";

/** A count, a capped count, a tally with its own text, or a dot: one element for all four. */
describe("Badge", () => {
  const badge = (ui: React.ReactElement) => render(ui).container.firstElementChild!;

  it("is an empty dot without a count", () => {
    const dot = badge(<Badge />);
    expect(dot).toBeEmptyDOMElement();
    expect(dot).toHaveClass("rounded-full", "size-1.5");
  });

  it("shows the count, and caps it at max", () => {
    expect(badge(<Badge count={4} max={9} />)).toHaveTextContent(/^4$/);
    expect(badge(<Badge count={12} max={9} />)).toHaveTextContent(/^9\+$/);
    expect(badge(<Badge count={12} />)).toHaveTextContent(/^12$/);
  });

  it("lets children replace the number and rings a floating badge", () => {
    expect(badge(<Badge tone="neutral">+3</Badge>)).toHaveTextContent(/^\+3$/);
    expect(badge(<Badge count={1} floating className="-right-1" />)).toHaveClass("absolute", "border-surface-950", "-right-1");
  });
});
