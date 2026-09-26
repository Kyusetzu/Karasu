import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContextMenu from "./ContextMenu";
import type { Action } from "@/lib/actions";

const ACTIONS: Action[] = [
  { id: "open", group: "item" },
  { id: "plusOne", group: "item" },
  { id: "edit", group: "edit" },
  {
    id: "setStatus",
    group: "edit",
    items: [
      { id: "setStatus", group: "edit", arg: { kind: "status", status: "COMPLETED" } },
      { id: "setStatus", group: "edit", arg: { kind: "status", status: "PAUSED" } },
    ],
  },
  { id: "removeFromList", group: "edit", danger: true },
  { id: "back", group: "app" },
];

function menu(x = 20, y = 20, onRun = vi.fn(), onClose = vi.fn()) {
  render(
    <ContextMenu
      x={x}
      y={y}
      actions={ACTIONS}
      mediaType="ANIME"
      onRun={onRun}
      onClose={onClose}
    />,
  );
  return { onRun, onClose };
}

const root = () => screen.getByRole("menu", { name: "ctx.menuLabel" });

describe("ContextMenu", () => {
  it("draws the actions it was given", () => {
    menu();
    expect(within(root()).getByRole("menuitem", { name: "ctx.open" })).toBeInTheDocument();
    expect(within(root()).getByRole("menuitem", { name: /actions\.changeStatus/ })).toBeInTheDocument();
  });

  it("runs a plain row and leaves a submenu row to open instead", () => {
    const { onRun } = menu();
    fireEvent.click(within(root()).getByRole("menuitem", { name: "common.plusOne" }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: "plusOne" }));

    onRun.mockClear();
    fireEvent.click(within(root()).getByRole("menuitem", { name: /actions\.changeStatus/ }));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "status.ANIME.COMPLETED" })).toBeInTheDocument();
  });

  it("takes focus so it is operable from the keyboard the moment it appears", async () => {
    menu();
    await waitFor(() => expect(root()).toHaveFocus());
  });

  it("roves with the arrows and jumps with Home and End", async () => {
    const user = userEvent.setup({ delay: null });
    menu();
    await waitFor(() => expect(root()).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveTextContent("ctx.open");
    await user.keyboard("{End}");
    expect(document.activeElement).toHaveTextContent("ctx.back");
    await user.keyboard("{Home}");
    expect(document.activeElement).toHaveTextContent("ctx.open");
  });

  /** A flyout that opens with the right arrow and cannot be left with the left one is worse than no flyout. */
  it("opens a submenu with the right arrow and leaves it with the left", async () => {
    const user = userEvent.setup({ delay: null });
    menu();
    await waitFor(() => expect(root()).toHaveFocus());
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(document.activeElement).toHaveTextContent(/actions\.changeStatus/);
    await user.keyboard("{ArrowRight}");
    const leaf = await screen.findByRole("menuitem", { name: "status.ANIME.COMPLETED" });
    // A browser moves focus into the flyout on the next frame; jsdom does not, so the test puts it where it lands.
    act(() => leaf.focus());
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "status.ANIME.COMPLETED" })).toBeNull());
  });

  it("closes one level at a time on Escape", async () => {
    const user = userEvent.setup({ delay: null });
    const { onClose } = menu();
    await user.click(within(root()).getByRole("menuitem", { name: /actions\.changeStatus/ }));
    expect(await screen.findByRole("menuitem", { name: "status.ANIME.COMPLETED" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "status.ANIME.COMPLETED" })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("runs the leaf the submenu was opened for", async () => {
    const { onRun } = menu();
    fireEvent.click(within(root()).getByRole("menuitem", { name: /actions\.changeStatus/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "status.ANIME.PAUSED" }));
    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({ arg: { kind: "status", status: "PAUSED" } }),
    );
  });

  it("does not close itself when a row is chosen, so the caller can hand over to a dialog first", () => {
    const { onClose } = menu();
    fireEvent.click(within(root()).getByRole("menuitem", { name: "common.edit" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("owns the keyboard while it is up", () => {
    menu();
    expect(document.querySelector("[data-overlay]")).not.toBeNull();
  });
});
