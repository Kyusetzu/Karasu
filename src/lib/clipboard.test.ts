import { beforeEach, describe, expect, it, vi } from "vitest";

/** Which clipboard the helper picks is the whole point: Rust's inside the app, the browser's outside it. */

const writeText = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const tauri = vi.hoisted(() => ({ on: false }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }));
vi.mock("@/api/anilist", () => ({
  get isTauri() {
    return tauri.on;
  },
}));

import { copyText } from "./clipboard";

const browser = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  browser.mockClear();
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: browser } }, configurable: true });
});

describe("copyText", () => {
  it("goes through the plugin inside the app", async () => {
    tauri.on = true;
    await expect(copyText("hi")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hi");
    expect(browser).not.toHaveBeenCalled();
  });

  it("goes through the browser outside it", async () => {
    tauri.on = false;
    await expect(copyText("hi")).resolves.toBe(true);
    expect(browser).toHaveBeenCalledWith("hi");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("answers false rather than throwing when the clipboard refuses", async () => {
    tauri.on = true;
    writeText.mockRejectedValueOnce(new Error("denied"));
    await expect(copyText("hi")).resolves.toBe(false);
  });
});
