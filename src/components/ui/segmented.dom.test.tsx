import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Segmented } from "./segmented";

type Lens = "grid" | "list" | "rows";

function Host({ start = "grid" as Lens }) {
  const [value, setValue] = useState<Lens>(start);
  return (
    <Segmented
      aria-label="View"
      value={value}
      onChange={setValue}
      segments={[
        { value: "grid", label: "Grid" },
        { value: "list", label: "List" },
        { value: "rows", label: "Rows" },
      ]}
    />
  );
}

/** A radio group with one tab stop: arrows move the choice and the focus together, and wrap at the ends. */
describe("Segmented", () => {
  it("holds one tab stop, on the chosen segment", () => {
    render(<Host start="list" />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    expect(screen.getByRole("radio", { name: "List" })).toHaveAttribute("aria-checked", "true");
  });

  it("walks the choice with the arrows, Home and End, wrapping at the ends", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Host />);
    await user.tab();
    expect(screen.getByRole("radio", { name: "Grid" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "List" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "List" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("radio", { name: "Rows" })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Grid" })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Rows" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("radio", { name: "Grid" })).toHaveAttribute("aria-checked", "true");
  });

  it("chooses on a click", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Host />);
    await user.click(screen.getByRole("radio", { name: "Rows" }));
    expect(screen.getByRole("radio", { name: "Rows" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radiogroup", { name: "View" })).toBeInTheDocument();
  });
});
