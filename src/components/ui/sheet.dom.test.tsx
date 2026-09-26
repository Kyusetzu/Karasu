import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet } from "./sheet";

/** The one modal sheet: named, owning the keyboard, and telling its caller how it was dismissed. */
describe("Sheet", () => {
  it("is a named dialog that owns the keyboard while it is up", () => {
    render(
      <Sheet open label="More" onClose={() => {}}>
        <button type="button">Settings</button>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "More" });
    expect(dialog).toHaveAttribute("data-overlay");
    expect(dialog).toContainElement(screen.getByRole("button", { name: "Settings" }));
  });

  it("reports Escape and a press on the dim as different dismissals", async () => {
    const user = userEvent.setup({ delay: null });
    const onClose = vi.fn();
    render(
      <Sheet open label="More" onClose={onClose}>
        <button type="button">Settings</button>
      </Sheet>,
    );
    // jsdom has no layout for Base UI's tabbable check, so focus lands on the sheet itself rather than its first control.
    await waitFor(() => expect(screen.getByRole("dialog", { name: "More" })).toContainElement(document.activeElement as HTMLElement));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenLastCalledWith("escape");
    await user.click(document.querySelector<HTMLElement>(".sheet-backdrop")!);
    expect(onClose).toHaveBeenLastCalledWith("outside");
  });

  it("renders nothing while closed", () => {
    render(
      <Sheet open={false} label="More" onClose={() => {}}>
        <p>hidden</p>
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
