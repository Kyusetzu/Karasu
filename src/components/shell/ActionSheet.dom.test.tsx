import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ActionSheet from "./ActionSheet";
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

function sheet(onRun = vi.fn(), onClose = vi.fn()) {
  render(
    <ActionSheet
      title="Cowboy Bebop"
      actions={ACTIONS}
      mediaType="ANIME"
      onRun={onRun}
      onClose={onClose}
    />,
  );
  return { onRun, onClose };
}

describe("ActionSheet", () => {
  it("names what was pressed and draws the actions it is willing to show", () => {
    sheet();
    expect(screen.getByText("Cowboy Bebop")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ctx.open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.plusOne" })).toBeInTheDocument();
  });

  /** The app chrome belongs to a mouse menu; a phone has a navigation bar for it. */
  it("leaves the app chrome out", () => {
    sheet();
    expect(screen.queryByRole("button", { name: "ctx.back" })).toBeNull();
  });

  it("runs a leaf action rather than drilling into it", () => {
    const { onRun } = sheet();
    fireEvent.click(screen.getByRole("button", { name: "common.plusOne" }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ id: "plusOne" }));
  });

  it("drills into a submenu and comes back out", () => {
    const { onRun } = sheet();
    fireEvent.click(screen.getByRole("button", { name: "actions.changeStatus" }));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "status.ANIME.COMPLETED" })).toBeInTheDocument();
    // The root rows are gone while drilled in, or the sheet would be two menus at once.
    expect(screen.queryByRole("button", { name: "common.plusOne" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "actions.changeStatus" }));
    expect(screen.getByRole("button", { name: "common.plusOne" })).toBeInTheDocument();
  });

  it("runs the leaf a drill-down was opened for", () => {
    const { onRun } = sheet();
    fireEvent.click(screen.getByRole("button", { name: "actions.changeStatus" }));
    fireEvent.click(screen.getByRole("button", { name: "status.ANIME.PAUSED" }));
    expect(onRun).toHaveBeenCalledWith(
      expect.objectContaining({ arg: { kind: "status", status: "PAUSED" } }),
    );
  });

  it("steps out of a submenu on Escape before it closes", () => {
    const { onClose } = sheet();
    fireEvent.click(screen.getByRole("button", { name: "actions.changeStatus" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "common.plusOne" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("owns the keyboard while it is up, like every other overlay", () => {
    sheet();
    expect(document.querySelector("[data-overlay]")).not.toBeNull();
  });
});
