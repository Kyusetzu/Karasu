import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Input } from "./input";

describe("Input", () => {
  /**
   * The reason `onClear` is opt-in. ~25 call sites pass width classes expecting
   * them to land on the `<input>` itself; an unconditional wrapper would move
   * every one of them onto a `<div>` and leave the field full-width inside it.
   */
  it("renders a bare input with no wrapper when no clear is asked for", () => {
    const { container } = render(<Input value="x" onChange={vi.fn()} className="w-20" />);
    expect(container.firstElementChild?.tagName).toBe("INPUT");
    expect(container.querySelector("input")?.className).toContain("w-20");
  });

  it("wraps only when clearing is offered, and keeps the class on the field", () => {
    const { container } = render(
      <Input value="x" onChange={vi.fn()} onClear={vi.fn()} clearLabel="Clear" className="w-20" />,
    );
    expect(container.firstElementChild?.tagName).toBe("DIV");
    expect(container.querySelector("input")?.className).toContain("w-20");
  });

  /** A button that does nothing is worse than none, and it would sit in the
   *  tab order permanently. */
  it("shows the button only when there is something to clear", () => {
    const { rerender } = render(
      <Input value="" onChange={vi.fn()} onClear={vi.fn()} clearLabel="Clear" />,
    );
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();

    rerender(<Input value="a" onChange={vi.fn()} onClear={vi.fn()} clearLabel="Clear" />);
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
  });

  it("reports the press without touching the value itself", () => {
    const onClear = vi.fn();
    const onChange = vi.fn();
    render(<Input value="abc" onChange={onChange} onClear={onClear} clearLabel="Clear" />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledOnce();
    // The caller owns the value — the button does not fake an input event.
    expect(onChange).not.toHaveBeenCalled();
  });

  /**
   * Taking focus on mousedown would blur the caret, and several of these boxes
   * commit on blur — so the press must not steal it.
   */
  it("does not take focus from the field", () => {
    render(<Input value="abc" onChange={vi.fn()} onClear={vi.fn()} clearLabel="Clear" />);
    const prevented = fireEvent.mouseDown(screen.getByRole("button", { name: "Clear" }));
    expect(prevented).toBe(false);
  });
});
