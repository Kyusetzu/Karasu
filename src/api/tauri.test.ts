import { describe, expect, it, vi } from "vitest";

/** `unwrap` is the one seam between the generated `Result` shape and the thrown strings every catch in the app expects. */

vi.mock("./bindings", () => ({ commands: {} }));

import { unwrap } from "./tauri";

describe("unwrap", () => {
  it("hands back the data of an ok result", async () => {
    await expect(unwrap(Promise.resolve({ status: "ok" as const, data: 42 }))).resolves.toBe(42);
  });

  it("rejects with the Rust error string itself, not an Error wrapping it", async () => {
    await expect(unwrap(Promise.resolve({ status: "error" as const, error: "Not connected to AniList" }))).rejects.toBe(
      "Not connected to AniList",
    );
  });

  it("lets a rejection from the bridge through untouched", async () => {
    await expect(unwrap(Promise.reject(new Error("ipc down")))).rejects.toThrow("ipc down");
  });

  it("reads a unit result as void", async () => {
    const done: void = await unwrap(Promise.resolve({ status: "ok" as const, data: null }));
    expect(done).toBeNull();
  });
});
