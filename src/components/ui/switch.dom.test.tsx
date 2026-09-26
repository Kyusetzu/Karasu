import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./switch";

/** The settings toggle's control: a switch to assistive technology, flipped by a click, Space or Enter. */
describe("Switch", () => {
  it("reports its state and asks for the opposite one", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    const { rerender } = render(<Switch aria-label="Blur" checked={false} onChange={onChange} />);
    const control = screen.getByRole("switch", { name: "Blur" });
    expect(control).toHaveAttribute("aria-checked", "false");
    await user.click(control);
    expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(<Switch aria-label="Blur" checked onChange={onChange} />);
    expect(control).toHaveAttribute("aria-checked", "true");
    control.focus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("does nothing while disabled", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<Switch aria-label="Blur" checked={false} disabled onChange={onChange} />);
    const control = screen.getByRole("switch", { name: "Blur" });
    expect(control).toBeDisabled();
    await user.click(control);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("answers a click on its label", async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(
      <label>
        <span>Blur adult covers</span>
        <Switch checked={false} onChange={onChange} />
      </label>,
    );
    await user.click(screen.getByText("Blur adult covers"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
