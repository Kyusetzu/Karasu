import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { checkA11y } from "@/test/a11y";
import { StatusTabs, type StatusTab } from "./status-tabs";

type S = "a" | "b" | "c" | "d";

const TABS: StatusTab<S>[] = [
  { value: "a", label: "Watching", count: 18, color: "var(--color-status-current)" },
  { value: "b", label: "Rewatching", count: 0, color: "var(--color-status-repeating)" },
  { value: "c", label: "Completed", count: 146, color: "var(--color-status-completed)" },
  { value: "d", label: "Planning", count: 40 },
];

function strip(value: S = "a", onChange = vi.fn()) {
  const view = render(<StatusTabs label="Status" tabs={TABS} value={value} onChange={onChange} />);
  return { ...view, onChange };
}

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });
const line = () => document.querySelector<HTMLElement>("[data-tab-line]")!;
const user = () => userEvent.setup({ delay: null });

describe("StatusTabs", () => {
  it("is one named tablist with one tab stop, on the active tab", () => {
    strip("c");
    expect(screen.getByRole("tablist", { name: "Status" })).toBeInTheDocument();
    expect(tab("Completed")).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab").filter((el) => el.tabIndex === 0)).toEqual([tab("Completed")]);
  });

  it("shows a count only where there is one", () => {
    strip();
    expect(tab("Watching")).toHaveTextContent("18");
    expect(tab("Rewatching")).toHaveTextContent(/^Rewatching$/);
  });

  /** Walking the row must not switch the list under the user; only a press does. */
  it("moves focus with the arrows and selects only on Enter", async () => {
    const { onChange } = strip();
    const u = user();
    tab("Watching").focus();
    await u.keyboard("{ArrowRight}");
    expect(tab("Rewatching")).toHaveFocus();
    expect(tab("Rewatching").tabIndex).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
    await u.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("jumps to either end and wraps round like any tab row", async () => {
    strip();
    const u = user();
    tab("Watching").focus();
    await u.keyboard("{End}");
    expect(tab("Planning")).toHaveFocus();
    await u.keyboard("{ArrowRight}");
    expect(tab("Watching")).toHaveFocus();
    await u.keyboard("{ArrowLeft}");
    expect(tab("Planning")).toHaveFocus();
    await u.keyboard("{Home}");
    expect(tab("Watching")).toHaveFocus();
  });

  /** Alt+Left is the back shortcut; the row must not eat it. */
  it("leaves modified arrows alone", async () => {
    strip();
    const u = user();
    tab("Watching").focus();
    await u.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(tab("Watching")).toHaveFocus();
  });

  it("gives the tab stop back to the active tab once focus leaves the row", async () => {
    render(
      <>
        <StatusTabs label="Status" tabs={TABS} value="a" onChange={vi.fn()} />
        <button type="button">after</button>
      </>,
    );
    const u = user();
    tab("Watching").focus();
    await u.keyboard("{ArrowRight}{ArrowRight}");
    await u.tab();
    expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
    expect(tab("Watching").tabIndex).toBe(0);
    expect(tab("Completed").tabIndex).toBe(-1);
  });

  it("paints the underline in the active tab's colour, and the accent where it has none", () => {
    const { rerender } = strip("c");
    expect(line().style.getPropertyValue("--tab-line")).toBe("var(--color-status-completed)");
    rerender(<StatusTabs label="Status" tabs={TABS} value="d" onChange={vi.fn()} />);
    expect(line().style.getPropertyValue("--tab-line")).toBe("var(--color-accent-500)");
    expect(line()).toHaveAttribute("aria-hidden", "true");
  });

  it("has no axe violations", async () => {
    const { container } = strip("b");
    expect(await checkA11y(container)).toHaveNoViolations();
  });
});
