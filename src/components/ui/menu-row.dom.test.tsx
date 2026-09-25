import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, NavLink } from "react-router";
import { Plus, Trash2 } from "lucide-react";
import { checkA11y } from "@/test/a11y";
import { MenuGroupLabel, MenuRow, MenuRowBody, MenuRowNote, MenuRowSeparator, menuRowClass } from "./menu-row";

/** The one row every sheet, panel and menu draws, so a choice looks and answers the same wherever it is offered. */
describe("MenuRow", () => {
  it("is a button named by its label, with the icon hidden and the caller's classes kept", async () => {
    const user = userEvent.setup({ delay: null });
    const onClick = vi.fn();
    const { container } = render(
      <MenuRow icon={Plus} className="mt-2" trailing={<MenuRowNote>Watching</MenuRowNote>} onClick={onClick}>
        Save this view
      </MenuRow>,
    );
    const row = screen.getByRole("button", { name: "Save this view Watching" });
    expect(row).toHaveAttribute("type", "button");
    expect(row).toHaveClass("mt-2", "min-h-9");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    await user.click(row);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("marks the chosen row for high contrast and tints its icon, and leaves the others unmarked", () => {
    render(
      <>
        <MenuRow icon={Plus} current>
          Chosen
        </MenuRow>
        <MenuRow icon={Plus}>Other</MenuRow>
      </>,
    );
    const chosen = screen.getByRole("button", { name: "Chosen" });
    expect(chosen).toHaveAttribute("data-current");
    expect(chosen).toHaveClass("bg-surface-800");
    expect(chosen.firstElementChild).toHaveClass("text-accent-400");
    expect(screen.getByRole("button", { name: "Other" })).not.toHaveAttribute("data-current");
  });

  it("draws a danger row in the danger ink, icon included, and a chevron for a row that opens more", () => {
    const { container } = render(
      <>
        <MenuRow icon={Trash2} danger>
          Remove
        </MenuRow>
        <MenuRow chevron>Change status</MenuRow>
      </>,
    );
    const remove = screen.getByRole("button", { name: "Remove" });
    expect(remove).toHaveClass("text-danger");
    expect(remove.firstElementChild).toHaveClass("text-danger");
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });

  it("gives a router link the same row, current when the route is", () => {
    render(
      <MemoryRouter initialEntries={["/calendar"]}>
        <NavLink to="/calendar" className={({ isActive }) => menuRowClass({ current: isActive })}>
          {({ isActive }) => (
            <MenuRowBody icon={Plus} current={isActive}>
              Calendar
            </MenuRowBody>
          )}
        </NavLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Calendar" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveClass("bg-surface-800");
  });

  it("lets a managed row take its highlight from data-highlighted rather than from hover, in high contrast too", () => {
    const managed = menuRowClass({ managed: true }).split(" ");
    expect(managed).toContain("data-highlighted:bg-surface-800");
    expect(managed).toContain("menu-row-edge-managed");
    expect(managed.some((c) => c.startsWith("hover:") || c === "menu-row-edge")).toBe(false);
    expect(menuRowClass().split(" ")).toEqual(expect.arrayContaining(["hover:bg-surface-850", "menu-row-edge"]));
  });

  it("keeps a sheet only a finger opens at the finger's size whatever the primary pointer", () => {
    render(<MenuRow size="touch">Open</MenuRow>);
    const row = screen.getByRole("button", { name: "Open" });
    expect(row).toHaveClass("min-h-11", "text-sm");
    expect(row.className).not.toContain("coarse:");
  });

  it("passes axe with a group label, rows and a rule", async () => {
    const { container } = render(
      <div>
        <MenuGroupLabel>Browse</MenuGroupLabel>
        <MenuRow icon={Plus}>Save this view</MenuRow>
        <MenuRowSeparator />
        <MenuRow danger>Remove</MenuRow>
      </div>,
    );
    expect(await checkA11y(container)).toHaveNoViolations();
  });
});
