import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { useState } from "react";
import { MarkdownTextarea, type MarkdownTextareaProps } from "./MarkdownTextarea";

/**
 * The shared composer field. `lib/composerEdits.test.ts` proves the
 * arithmetic; this proves the component reads the selection, writes the
 * result back through `onChange` (jsdom has no `execCommand`, which is also
 * the fallback path in a browser that refuses it), keeps the field mounted
 * under a preview, and wires the shortcuts.
 */

function Harness(props: Partial<MarkdownTextareaProps> & { initial?: string; onValue?: (v: string) => void }) {
  const { initial = "", onValue, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <MemoryRouter>
      <label htmlFor="field">the field</label>
      <MarkdownTextarea
        id="field"
        value={value}
        onChange={(v) => {
          setValue(v);
          onValue?.(v);
        }}
        {...rest}
      />
    </MemoryRouter>
  );
}

const field = () => screen.getByLabelText("the field") as HTMLTextAreaElement;

function select(start: number, end: number) {
  const el = field();
  el.focus();
  el.setSelectionRange(start, end);
}

describe("MarkdownTextarea", () => {
  it("names every toolbar button", () => {
    render(<Harness />);
    const toolbar = screen.getByRole("toolbar", { name: "composer.toolbar" });
    const buttons = toolbar.querySelectorAll("button");
    expect(buttons.length).toBe(13);
    for (const b of buttons) expect(b.getAttribute("aria-label")).toBeTruthy();
    expect(screen.getByRole("button", { name: "composer.bold" }).getAttribute("title")).toContain("Ctrl+B");
  });

  it("wraps the selection when a button is pressed, keeping the focus in the field", () => {
    const onValue = vi.fn();
    render(<Harness initial="a sel b" onValue={onValue} />);
    select(2, 5);
    const bold = screen.getByRole("button", { name: "composer.bold" });
    const down = fireEvent.mouseDown(bold);
    // `preventDefault` on mousedown is what keeps the selection alive.
    expect(down).toBe(false);
    fireEvent.click(bold);
    expect(onValue).toHaveBeenCalledWith("a **sel** b");
    expect(field().value).toBe("a **sel** b");
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd]).toEqual([4, 7]);
  });

  it("binds Ctrl+B, Ctrl+I, Ctrl+Shift+X and Ctrl+Shift+S on the field", () => {
    render(<Harness initial="word" />);
    select(0, 4);
    fireEvent.keyDown(field(), { key: "b", ctrlKey: true });
    expect(field().value).toBe("**word**");
    select(2, 6);
    fireEvent.keyDown(field(), { key: "i", ctrlKey: true });
    expect(field().value).toBe("***word***");
    select(3, 7);
    fireEvent.keyDown(field(), { key: "X", ctrlKey: true, shiftKey: true });
    expect(field().value).toBe("***~~word~~***");
    select(5, 9);
    fireEvent.keyDown(field(), { key: "S", ctrlKey: true, shiftKey: true });
    expect(field().value).toBe("***~~~!word!~~~***");
  });

  it("sends on Ctrl+Enter and only then", () => {
    const onSubmit = vi.fn();
    render(<Harness initial="hi" onSubmit={onSubmit} />);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(field(), { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("keeps the field mounted under a toggled preview, so its label still finds it", () => {
    render(<Harness initial="**bold** words" preview="toggle" />);
    fireEvent.click(screen.getByRole("button", { name: /social\.previewOn/ }));
    expect(field().hidden).toBe(true);
    expect(screen.getByLabelText("the field")).toBe(field());
    // Rendered, not raw: the word is there and the markers are not.
    expect(screen.getByText("bold")).toBeTruthy();
    expect(screen.queryByText(/\*\*/, { ignore: "textarea" })).toBeNull();
    expect(screen.getByRole("button", { name: "composer.bold" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /social\.previewOff/ }));
    expect(field().hidden).toBe(false);
  });

  it("shows the empty-preview sentence when there is nothing to render", () => {
    render(<Harness initial="   " preview="toggle" previewSource="" />);
    // The toggle is disabled on a blank draft, so this reaches the sentence
    // through the side-by-side form instead.
    render(<Harness initial="" preview="side" previewEmpty="nothing here" />);
    expect(screen.getByText("nothing here")).toBeTruthy();
  });

  it("compact: no toolbar until the field is focused or has text, and a subset when it is", () => {
    render(<Harness variant="compact" />);
    expect(screen.queryByRole("toolbar")).toBeNull();
    fireEvent.focus(field());
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.querySelectorAll("button").length).toBe(6);
    fireEvent.blur(field());
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("side preview renders the draft beside the field", () => {
    render(<Harness initial="~!hidden!~ shown" preview="side" />);
    // The spoiler is a button in the preview, and the field stays visible.
    expect(screen.getByRole("button", { name: /social\.mdSpoiler/ })).toBeTruthy();
    expect(screen.queryByText(/hidden/, { ignore: "textarea" })).toBeNull();
    expect(field().hidden).toBe(false);
    expect(field().value).toBe("~!hidden!~ shown");
  });
});
