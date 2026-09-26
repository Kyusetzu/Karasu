import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { useState } from "react";
import { MarkdownTextarea } from "./MarkdownTextarea";

/** The phone's composer: the marks used most in the row, the rest behind "More". */

vi.mock("@/hooks/usePhoneShell", () => ({ usePhoneShell: () => true }));

function Harness({ onValue }: { onValue?: (v: string) => void }) {
  const [value, setValue] = useState("");
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
      />
    </MemoryRouter>
  );
}

const user = userEvent.setup({ delay: null });

describe("MarkdownTextarea on a phone", () => {
  it("keeps six marks and a More button in the row", () => {
    render(<Harness />);
    const toolbar = screen.getByRole("toolbar", { name: "composer.toolbar" });
    const labels = [...toolbar.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual([
      "composer.bold",
      "composer.italic",
      "composer.strike",
      "composer.spoiler",
      "composer.link",
      "composer.image",
      "composer.more",
    ]);
  });

  it("offers the rest in the More menu and applies the chosen one", async () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const more = screen.getByRole("button", { name: "composer.more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    const menu = await screen.findByRole("menu", { name: "composer.more" });
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(menu).toHaveTextContent("composer.heading");
    expect(menu).not.toHaveTextContent("composer.bold");
    await user.click(screen.getByRole("menuitem", { name: "composer.bullets" }));
    expect(onValue).toHaveBeenLastCalledWith(expect.stringMatching(/^- /));
  });
});
