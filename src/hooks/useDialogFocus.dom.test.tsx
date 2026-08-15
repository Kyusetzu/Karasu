import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDialogFocus } from "./useDialogFocus";

/**
 * The two things every Karasu dialog got wrong until this hook: Tab walked out
 * into the page behind the scrim, and closing dropped focus to `<body>`.
 *
 * Driven through a bare harness rather than a real overlay, so a failure points
 * at the hook rather than at whichever dialog happened to be under test.
 */

function Dialog({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel);
  return (
    <div ref={panel} role="dialog">
      <button type="button">first</button>
      <button type="button">middle</button>
      <button type="button" onClick={onClose}>
        last
      </button>
    </div>
  );
}

function Harness({ withField = false }: { withField?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        opener
      </button>
      <button type="button">behind</button>
      {open &&
        (withField ? <DialogWithField /> : <Dialog onClose={() => setOpen(false)} />)}
    </div>
  );
}

/** The shape three overlays have: their own field, focused on mount. */
function DialogWithField() {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel);
  return (
    <div ref={panel} role="dialog">
      <button type="button">before the field</button>
      <input aria-label="search" autoFocus />
    </div>
  );
}

const press = (shift = false) =>
  fireEvent.keyDown(document.activeElement ?? document, {
    key: "Tab",
    shiftKey: shift,
  });

/**
 * Focus, then click. A real browser focuses a button on mousedown, and jsdom
 * does not — without this the hook records `<body>` as the opener and the
 * restore test would be asserting jsdom's behaviour rather than the app's.
 */
function open() {
  const opener = screen.getByText("opener");
  opener.focus();
  fireEvent.click(opener);
}

describe("useDialogFocus", () => {
  it("takes the keyboard when the dialog opens", () => {
    render(<Harness />);
    open();
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("leaves an overlay that focused its own field alone", () => {
    render(<Harness withField />);
    open();
    expect(document.activeElement).toBe(screen.getByLabelText("search"));
  });

  /** The bug: Tab from the last control reached the page under the scrim. */
  it("wraps forward from the last control to the first", () => {
    render(<Harness />);
    open();
    screen.getByText("last").focus();
    press();
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("wraps backward from the first control to the last", () => {
    render(<Harness />);
    open();
    press(true);
    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("does not intercept a Tab in the middle of the dialog", () => {
    render(<Harness />);
    open();
    screen.getByText("middle").focus();
    press();
    // Left to the browser, which is the point — the hook only handles the ends.
    expect(document.activeElement).toBe(screen.getByText("middle"));
  });

  /** Focus that escaped — a click behind the scrim — is pulled back in. */
  it("recaptures focus that ended up outside", () => {
    render(<Harness />);
    open();
    screen.getByText("behind").focus();
    press();
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  /** The other half: closing used to drop the caret at the top of the page. */
  it("gives focus back to whatever opened it", async () => {
    render(<Harness />);
    const opener = screen.getByText("opener");
    open();
    fireEvent.click(screen.getByText("last"));
    // The restore is deferred by a microtask — see the hook for why.
    await Promise.resolve();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
