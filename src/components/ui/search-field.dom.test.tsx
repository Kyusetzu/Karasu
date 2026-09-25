import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { checkA11y } from "@/test/a11y";
import { Modal } from "./modal";
import { SearchField } from "./search-field";

function Controlled(props: Partial<Parameters<typeof SearchField>[0]>) {
  const [value, setValue] = useState(props.value ?? "");
  return <SearchField label="Search" clearLabel="Clear" {...props} value={value} onChange={setValue} />;
}

/** The one search field, so the list, the pages, the panels and the dialogs all clear and let go the same way. */
describe("SearchField", () => {
  it("is a searchbox named by its label, with the clear button only while there is a query", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Controlled placeholder="Filter…" />);
    const box = screen.getByRole("searchbox", { name: "Search" });
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    await user.type(box, "frieren");
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("keeps the caret on a pointer clear and hands it back after a keyboard one", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Controlled value="frieren" />);
    const clear = screen.getByRole("button", { name: "Clear" });
    // Several fields commit on blur, so the press must not take the focus from them.
    expect(fireEvent.mouseDown(clear)).toBe(false);
    clear.focus();
    await user.keyboard("{Enter}");
    const box = screen.getByRole("searchbox", { name: "Search" });
    expect(box).toHaveValue("");
    expect(box).toHaveFocus();
  });

  it("empties on Escape and stops there, so a dialog around it stays open", async () => {
    const user = userEvent.setup({ delay: null });
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    render(<Controlled value="frieren" />);
    const box = screen.getByRole("searchbox", { name: "Search" });
    box.focus();
    await user.keyboard("{Escape}");
    expect(box).toHaveValue("");
    expect(box).toHaveFocus();
    expect(onWindow).not.toHaveBeenCalled();
    // Empty, the press is not the field's: it reaches whatever is around it untouched.
    await user.keyboard("{Escape}");
    expect(onWindow).toHaveBeenCalledOnce();
    expect(onWindow.mock.calls[0][0].defaultPrevented).toBe(false);
    window.removeEventListener("keydown", onWindow);
  });

  it("leaves the dialog around it open on the Escape that empties it, and lets the next one close it", async () => {
    const user = userEvent.setup({ delay: null });
    const onClose = vi.fn();
    render(
      <Modal title="Pick a title" onClose={onClose}>
        <Controlled value="frieren" autoFocus />
      </Modal>,
    );
    const box = screen.getByRole("searchbox", { name: "Search" });
    box.focus();
    await user.keyboard("{Escape}");
    expect(box).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("lets go of an empty field on a second Escape where the find bar's habit is asked for", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Controlled value="x" blurOnEscape />);
    const box = screen.getByRole("searchbox", { name: "Search" });
    box.focus();
    await user.keyboard("{Escape}{Escape}");
    expect(box).not.toHaveFocus();
  });

  it("marks a filled filter, spins while a request is out, and passes axe", async () => {
    const { container } = render(<Controlled value="x" markFilled busy trailing={<span role="status">3</span>} />);
    expect(container.firstElementChild).toHaveClass("border-accent-500/60");
    expect(screen.getByRole("status")).toHaveTextContent("3");
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(await checkA11y(container)).toHaveNoViolations();
  });
});
