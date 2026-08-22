import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * The inlined bio image, which only exists under Tauri — everywhere else it
 * falls back to the chip, which is why the other RichText suites never see it.
 */
vi.mock("@/api/anilist", async (orig) => ({
  ...(await orig<typeof import("@/api/anilist")>()),
  isTauri: true,
  fetchBioImage: (url: string) =>
    Promise.resolve(`data:image/png;base64,AAAA#${encodeURIComponent(url)}`),
}));

import { Markdown } from "./social/Markdown";

const draw = (source: string) => render(<Markdown source={source} />);

describe("an inlined bio image", () => {
  it("is inline-level, so a centred bio centres it", async () => {
    draw("~~~img(https://i.imgur.com/a.png)~~~");
    const img = await waitFor(() => {
      const el = document.querySelector("img");
      expect(el).not.toBeNull();
      return el!;
    });
    // `~~~centered~~~` is `text-align: center`, which does nothing to a block
    // box — a `block` image sat hard left in a centred bio while the text
    // around it centred. The class is the mechanism, so the class is the
    // assertion.
    const box = img.closest("button")!;
    expect(box.className).toContain("inline-block");
    expect(box.className).not.toMatch(/(^|\s)block(\s|$)/);
  });

  it("still only ever carries a data: src", async () => {
    draw("img(https://i.imgur.com/a.png)");
    await waitFor(() => expect(document.querySelector("img")).not.toBeNull());
    expect(document.querySelector("img")!.getAttribute("src")).toMatch(/^data:/);
  });

  /**
   * The chip fallback is not re-tested here: `Markdown.dom.test.tsx` runs with
   * `isTauri` false, which is exactly the failure path, and every image in that
   * suite is already asserted to be a chip.
   */
});
