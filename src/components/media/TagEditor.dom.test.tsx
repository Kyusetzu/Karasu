import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import TagEditor from "./TagEditor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key === "tags.remove" ? `Remove ${vars?.tag}` : key,
  }),
}));

/**
 * The shape that used to ship: a caption and the editor inside one `<label>`.
 *
 * `TagEditor` renders each chip's remove `<button>` before its `<input>`, and
 * `<button>` is a labelable element — so the label's labelled control was the
 * *first chip's ×*. Every click inside the label that was not on interactive
 * content forwarded there: the caption, the box's padding, and the text of any
 * other chip. Clicking "beta" deleted "alpha", with no undo, persisted on Save.
 *
 * jsdom implements label activation forwarding, so this reproduces it.
 */
function Wrapped({ onChange }: { onChange: (t: string[]) => void }) {
  return (
    <label>
      <span>Tags</span>
      <TagEditor tags={["alpha", "beta"]} onChange={onChange} />
    </label>
  );
}

/** What ships now — the caption names the input, and owns no control. */
function Current({ onChange }: { onChange: (t: string[]) => void }) {
  return (
    <div>
      <span id="cap">Tags</span>
      <TagEditor tags={["alpha", "beta"]} onChange={onChange} labelledBy="cap" />
    </div>
  );
}

describe("TagEditor inside a caption", () => {
  it("loses a tag when a label wraps it — the bug, pinned", () => {
    const onChange = vi.fn();
    render(<Wrapped onChange={onChange} />);
    fireEvent.click(screen.getByText("Tags"));
    expect(onChange).toHaveBeenCalledWith(["beta"]);
  });

  it("keeps every tag when the caption only names the input", () => {
    const onChange = vi.fn();
    render(<Current onChange={onChange} />);
    fireEvent.click(screen.getByText("Tags"));
    expect(onChange).not.toHaveBeenCalled();
  });

  // `combobox`, not `textbox`: the input carries a `list`, so it is one.
  it("gives the input an accessible name from that caption", () => {
    render(<Current onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Tags" })).toBeTruthy();
  });

  /** The × still removes exactly its own chip. */
  it("still removes the tag its button belongs to", () => {
    const onChange = vi.fn();
    render(<Current onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove beta" }));
    expect(onChange).toHaveBeenCalledWith(["alpha"]);
  });
});
