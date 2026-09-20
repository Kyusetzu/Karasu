import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

afterEach(() => {
  window.innerWidth = 1024;
  window.innerHeight = 768;
});

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

  it("takes focus so it is operable from the keyboard the moment it appears", () => {
    menu();
    expect(document.activeElement).toBe(
      within(root()).getByRole("menuitem", { name: "ctx.open" }),
    );
  });

  it("roves with the arrows and jumps with Home and End", () => {
    menu();
    fireEvent.keyDown(root(), { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("common.plusOne");
    fireEvent.keyDown(root(), { key: "End" });
    expect(document.activeElement?.textContent).toContain("ctx.back");
    fireEvent.keyDown(root(), { key: "Home" });
    expect(document.activeElement?.textContent).toContain("ctx.open");
  });

  /** A flyout that opens with the right arrow and cannot be left with the left one is worse than no flyout. */
  it("opens a submenu with the right arrow and leaves it with the left", () => {
    menu();
    fireEvent.keyDown(root(), { key: "ArrowDown" });
    fireEvent.keyDown(root(), { key: "ArrowDown" });
    fireEvent.keyDown(root(), { key: "ArrowDown" });
    fireEvent.keyDown(root(), { key: "ArrowRight" });
    expect(screen.getByRole("menuitem", { name: "status.ANIME.COMPLETED" })).toBeInTheDocument();
    fireEvent.keyDown(root(), { key: "ArrowLeft" });
    expect(screen.queryByRole("menuitem", { name: "status.ANIME.COMPLETED" })).toBeNull();
  });

  it("closes one level at a time on Escape", () => {
    const { onClose } = menu();
    fireEvent.click(within(root()).getByRole("menuitem", { name: /actions\.changeStatus/ }));
    fireEvent.keyDown(root(), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(root(), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("runs the leaf the submenu was opened for", () => {
    const { onRun } = menu();
    fireEvent.click(within(root()).getByRole("menuitem", { name: /actions\.changeStatus/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "status.ANIME.PAUSED" }));
    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({ arg: { kind: "status", status: "PAUSED" } }),
    );
  });

  /** The separators are real height; counting rows alone walked the menu off the bottom once a second group appeared. */
  it("stays inside the viewport when opened at the far corner", () => {
    window.innerWidth = 360;
    window.innerHeight = 320;
    menu(355, 315);
    const style = root().style;
    const left = parseFloat(style.left);
    const top = parseFloat(style.top);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left + 13.75 * 16).toBeLessThanOrEqual(360);
    // Six rows and two group boundaries, at the rem sizes the component clamps with.
    expect(top + (6 * 1.875 + 2 * 0.5) * 16).toBeLessThanOrEqual(320);
  });

  /** The root menu's clamp was asserted from the start; the flyout's own was not, and it is a second panel wide. */
  it("keeps a submenu inside the viewport instead of hanging it off the right edge", () => {
    window.innerWidth = 900;
    window.innerHeight = 700;
    menu(500, 100);
    fireEvent.click(within(root()).getByRole("menuitem", { name: /actions\.changeStatus/ }));
    const panels = screen.getAllByRole("menu");
    const flyout = panels[panels.length - 1];
    const left = parseFloat((flyout as HTMLElement).style.left);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + 13.75 * 16).toBeLessThanOrEqual(900);
  });

  it("keeps a submenu on screen in a window too narrow for either side", () => {
    window.innerWidth = 380;
    window.innerHeight = 700;
    menu(20, 100);
    fireEvent.click(within(root()).getByRole("menuitem", { name: /actions\.changeStatus/ }));
    const panels = screen.getAllByRole("menu");
    const flyout = panels[panels.length - 1];
    expect(parseFloat((flyout as HTMLElement).style.left)).toBeGreaterThanOrEqual(0);
  });

  it("owns the keyboard while it is up", () => {
    menu();
    expect(document.querySelector("[data-overlay]")).not.toBeNull();
  });
});
