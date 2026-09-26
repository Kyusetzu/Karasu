import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NumberInput } from "./number-input";

/** The field as an editor holds it: a number in state, reported on every keystroke. */
function Probe({ initial, max, spy }: { initial: number; max?: number; spy: (n: number) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <NumberInput
      aria-label="progress"
      value={value}
      max={max}
      onChange={(n) => {
        spy(n);
        setValue(n);
      }}
    />
  );
}

const field = () => screen.getByRole("spinbutton", { name: "progress" });

describe("NumberInput", () => {
  /** The bug: a field at 0 could not be emptied, so typing 7 after "Watching" gave 07. */
  it("shows a stored 0 as the placeholder, so a typed digit is the whole count", async () => {
    const user = userEvent.setup({ delay: null });
    const spy = vi.fn();
    render(<Probe initial={0} spy={spy} />);
    expect(field()).toHaveValue(null);
    expect(field()).toHaveAttribute("placeholder", "0");
    await user.type(field(), "7");
    expect(field()).toHaveValue(7);
    expect(spy).toHaveBeenLastCalledWith(7);
  });

  it("can be emptied while typing, and reports that as 0 rather than nothing", async () => {
    const user = userEvent.setup({ delay: null });
    const spy = vi.fn();
    render(<Probe initial={11} spy={spy} />);
    await user.clear(field());
    expect(field()).toHaveValue(null);
    expect(spy).toHaveBeenLastCalledWith(0);
    await user.type(field(), "5");
    expect(field()).toHaveValue(5);
    expect(spy).toHaveBeenLastCalledWith(5);
  });

  it("holds a typed count inside its maximum", async () => {
    const user = userEvent.setup({ delay: null });
    const spy = vi.fn();
    render(<Probe initial={0} max={13} spy={spy} />);
    await user.type(field(), "15");
    expect(field()).toHaveValue(13);
    expect(spy).toHaveBeenLastCalledWith(13);
  });

  it("follows a value the caller changes, such as the fill into Completed", () => {
    const { rerender } = render(<NumberInput aria-label="progress" value={3} onChange={vi.fn()} />);
    rerender(<NumberInput aria-label="progress" value={13} onChange={vi.fn()} />);
    expect(field()).toHaveValue(13);
  });

  it("selects its text on focus, so typing replaces the count", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Probe initial={11} spy={vi.fn()} />);
    await user.click(field());
    const input = field() as HTMLInputElement;
    // jsdom keeps no selection on a number input, so the call is what is checked.
    const select = vi.spyOn(input, "select");
    input.blur();
    await user.click(field());
    expect(select).toHaveBeenCalled();
  });
});
