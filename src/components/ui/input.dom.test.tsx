import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { Input } from "./input";

describe("Input", () => {
  /** Callers pass width classes expecting them to land on the `<input>` itself. */
  it("renders a bare input that keeps the caller's classes", () => {
    const { container } = render(<Input value="x" onChange={vi.fn()} className="w-20" />);
    expect(container.firstElementChild?.tagName).toBe("INPUT");
    expect(container.querySelector("input")).toHaveClass("w-20", "rounded-control");
  });
});
