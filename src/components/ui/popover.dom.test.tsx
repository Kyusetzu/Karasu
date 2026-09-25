import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover } from "./popover";

/** The panel primitive the list toolbar builds on: who opens it, what closes it, and what it leaves in history. */

function Probe({
  name = "Sort",
  variant = "dropdown",
  onOpen,
  onClosed,
  then = () => {},
}: {
  name?: string;
  variant?: "dropdown" | "sheet";
  onOpen?: () => void;
  onClosed?: () => void;
  then?: () => void;
}) {
  return (
    <Popover
      label={name}
      variant={variant}
      onOpen={onOpen}
      onClosed={onClosed}
      renderTrigger={(props) => (
        <button type="button" {...props}>
          {name}
        </button>
      )}
    >
      {({ close, closeThen }) => (
        <>
          <button type="button" onClick={close}>
            {name} done
          </button>
          <button type="button" onClick={() => closeThen(then)}>
            {name} apply
          </button>
        </>
      )}
    </Popover>
  );
}

const trigger = (name = "Sort") => screen.getByRole("button", { name });
const dialog = (name = "Sort") => screen.queryByRole("dialog", { name });
/** Ours when the current history entry is one a panel pushed. */
const onPanelEntry = () =>
  typeof window.history.state === "object" && window.history.state !== null && "karasuBack" in window.history.state;

beforeEach(() => document.documentElement.setAttribute("data-reduce-motion", ""));
afterEach(async () => {
  // Before the setup file's own cleanup, which runs after this hook, so a panel left open unwinds here.
  cleanup();
  document.documentElement.removeAttribute("data-reduce-motion");
  // Every test must leave history where it found it, or the next one opens behind a pending unwind.
  await waitFor(() => {
    if (onPanelEntry()) throw new Error("a panel's history entry is still unwinding");
  });
});

describe("Popover", () => {
  it("opens from its trigger and says so", () => {
    render(<Probe />);
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(trigger()).not.toHaveAttribute("aria-controls");
    fireEvent.click(trigger());
    const panel = dialog();
    expect(panel).toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAttribute("aria-controls", panel!.id);
    expect(screen.getByRole("button", { name: "Sort done" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Sort done" }));
    expect(dialog()).toBeNull();
  });

  it("closes on Escape and hands the keyboard back to the trigger", () => {
    render(<Probe />);
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("button", { name: "Sort done" }), { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("closes on a press outside and stays open on one inside", () => {
    render(
      <>
        <Probe />
        <p>elsewhere</p>
      </>,
    );
    fireEvent.click(trigger());
    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort apply" }));
    expect(dialog()).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText("elsewhere"));
    expect(dialog()).toBeNull();
  });

  /** A key pressed during the exit must not reach the list behind a panel that is still on screen. */
  it("keeps data-overlay while it animates out", async () => {
    document.documentElement.removeAttribute("data-reduce-motion");
    render(<Probe />);
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(dialog()).toHaveAttribute("data-overlay");
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it("closes on the back gesture and reports it closed", async () => {
    const onClosed = vi.fn();
    render(<Probe onClosed={onClosed} />);
    fireEvent.click(trigger());
    expect(onPanelEntry()).toBe(true);
    window.history.back();
    await waitFor(() => expect(dialog()).toBeNull());
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("runs onOpen before its history entry exists", () => {
    let pushed: boolean | null = null;
    render(<Probe onOpen={() => (pushed = onPanelEntry())} />);
    fireEvent.click(trigger());
    expect(pushed).toBe(false);
    expect(onPanelEntry()).toBe(true);
  });

  /** A URL write or a dialog from inside the panel must wait, or it lands on the entry the close is popping. */
  it("runs a closeThen action once the entry has unwound, with focus on the trigger", async () => {
    const seen: { entry: boolean; focus: Element | null }[] = [];
    const then = () => seen.push({ entry: onPanelEntry(), focus: document.activeElement });
    const onClosed = vi.fn();
    render(<Probe then={then} onClosed={onClosed} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Sort apply" }));
    expect(dialog()).toBeNull();
    // Reported at once, so a caller's own write is queued ahead of anything the user does next.
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ entry: false, focus: trigger() });
  });

  /** Opening a sibling closes this one in the same press; the new entry must not be pushed under the unwinding one. */
  it("waits for a sibling's unwind before pushing its own entry", async () => {
    render(
      <>
        <Probe name="Sort" />
        <Probe name="Filter" />
      </>,
    );
    fireEvent.click(trigger("Sort"));
    fireEvent.pointerDown(trigger("Filter"));
    fireEvent.click(trigger("Filter"));
    expect(dialog("Sort")).toBeNull();
    await waitFor(() => expect(dialog("Filter")).toBeInTheDocument());
    expect(onPanelEntry()).toBe(true);
    window.history.back();
    await waitFor(() => expect(dialog("Filter")).toBeNull());
  });

  it("draws the sheet at the body with a backdrop that closes it", async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<Probe variant="sheet" />);
    await user.click(trigger());
    const panel = dialog();
    expect(panel).toBeInTheDocument();
    expect(container.contains(panel)).toBe(false);
    expect(panel).toHaveAttribute("data-overlay");
    await user.click(document.querySelector<HTMLElement>(".sheet-backdrop")!);
    await waitFor(() => expect(dialog()).toBeNull());
  });
});
