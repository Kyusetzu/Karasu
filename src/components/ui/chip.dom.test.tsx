import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Trophy } from "lucide-react";
import { Chip, RemovableChip } from "./chip";

/** The one small label, and the one that can be taken away, so no screen spells either by hand. */
describe("Chip", () => {
  it("shows its text with a hidden glyph and takes the caller's classes last", () => {
    const { container } = render(
      <Chip tone="gold" icon={Trophy} className="border-dashed">
        #3 Highest rated
      </Chip>,
    );
    expect(screen.getByText("#3 Highest rated")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.firstElementChild).toHaveClass("border-dashed", "rounded-inner");
  });

  it("is removed by a click on the whole chip, named for what it removes", async () => {
    const user = userEvent.setup({ delay: null });
    const onRemove = vi.fn();
    render(
      <RemovableChip removeLabel="Remove filter TV" onRemove={onRemove}>
        TV
      </RemovableChip>,
    );
    await user.click(screen.getByRole("button", { name: "Remove filter TV" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
