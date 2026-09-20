import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useDialogFocus } from "./useDialogFocus";

/** Proves Tab stays inside the dialog and closing restores focus, through a bare harness so a failure blames the hook. */

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

const user = userEvent.setup({ delay: null });

/** A real Tab: user-event moves the focus itself unless the hook took the key, so "left to the browser" is testable. */
const press = (shift = false) => user.tab({ shift });

/** Focus before clicking; jsdom does not focus on mousedown, and the hook would record `<body>` as the opener. */
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
  it("wraps forward from the last control to the first", async () => {
    render(<Harness />);
    open();
    screen.getByText("last").focus();
    await press();
    expect(document.activeElement).toBe(screen.getByText("first"));
  });

  it("wraps backward from the first control to the last", async () => {
    render(<Harness />);
    open();
    await press(true);
    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  it("does not intercept a Tab in the middle of the dialog", async () => {
    render(<Harness />);
    open();
    screen.getByText("middle").focus();
    await press();
    // Left to the browser, which is the point — the hook only handles the ends.
    expect(document.activeElement).toBe(screen.getByText("last"));
  });

  /** Focus that escaped — a click behind the scrim — is pulled back in. */
  it("recaptures focus that ended up outside", async () => {
    render(<Harness />);
    open();
    screen.getByText("behind").focus();
    await press();
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
