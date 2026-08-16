import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_COLLAPSED, loadCollapsed, saveCollapsed } from "./sidebarWidth";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

afterEach(() => store.clear());

describe("sidebar collapse", () => {
  it("starts expanded", () => {
    expect(DEFAULT_COLLAPSED).toBe(false);
    expect(loadCollapsed()).toBe(false);
  });

  it("round-trips", () => {
    saveCollapsed(true);
    expect(loadCollapsed()).toBe(true);
    saveCollapsed(false);
    expect(loadCollapsed()).toBe(false);
  });

  /**
   * Anything a hand-edit or an older build left behind has to read as the
   * default rather than throw on the shell's very first render.
   */
  it("treats anything but the literal as expanded", () => {
    for (const junk of ["1", "yes", "TRUE", "", "{}"]) {
      store.set("karasu-sidebar", junk);
      expect(loadCollapsed(), junk).toBe(false);
    }
  });

  /** Private-mode localStorage throws on read *and* write. */
  it("survives storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(loadCollapsed()).toBe(false);
    expect(() => saveCollapsed(true)).not.toThrow();
  });
});
