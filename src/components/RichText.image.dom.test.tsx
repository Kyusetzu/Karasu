import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

/**
 * The inlined bio image, which only exists under Tauri — everywhere else it
 * falls back to the chip, which is why the other RichText suites never see it.
 */
const fetches = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/api/anilist", async (orig) => ({
  ...(await orig<typeof import("@/api/anilist")>()),
  isTauri: true,
  fetchBioImage: (url: string) => {
    fetches.count += 1;
    return Promise.resolve(`data:image/png;base64,AAAA#${encodeURIComponent(url)}`);
  },
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

  it("fetches one URL once across mounts, and a second URL once more", async () => {
    const before = fetches.count;
    const first = draw("img(https://i.imgur.com/once.png)");
    await waitFor(() => expect(document.querySelector("img")).not.toBeNull());
    first.unmount();
    draw("img(https://i.imgur.com/once.png) img(https://i.imgur.com/once.png)");
    await waitFor(() => expect(document.querySelectorAll("img")).toHaveLength(2));
    expect(fetches.count - before).toBe(1);
    draw("img(https://i.imgur.com/twice.png)");
    await waitFor(() => expect(document.querySelectorAll("img")).toHaveLength(3));
    expect(fetches.count - before).toBe(2);
  });

  /**
   * The chip fallback is not re-tested here: `Markdown.dom.test.tsx` runs with
   * `isTauri` false, which is exactly the failure path, and every image in that
   * suite is already asserted to be a chip.
   */
});
