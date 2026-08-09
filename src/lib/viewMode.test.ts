import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_VIEW,
  loadViewMode,
  saveViewMode,
  type ViewMode,
} from "./viewMode";

const KEY = "karasu-list-view";

/** A localStorage good enough for these, since vitest runs without a DOM. */
function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
  vi.stubGlobal("localStorage", storage);
  return data;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("loadViewMode", () => {
  it("defaults to the grid when nothing is stored", () => {
    stubStorage();
    expect(loadViewMode("ANIME")).toBe(DEFAULT_VIEW);
    expect(DEFAULT_VIEW).toBe("grid");
  });

  it("round-trips a saved mode", () => {
    stubStorage();
    saveViewMode("ANIME", "rows");
    expect(loadViewMode("ANIME")).toBe("rows");
  });

  /** The two are separate habits — a cover wall for one, a table for the other. */
  it("keeps anime and manga apart", () => {
    stubStorage();
    saveViewMode("ANIME", "rows");
    expect(loadViewMode("MANGA")).toBe("grid");
    saveViewMode("MANGA", "grid");
    expect(loadViewMode("ANIME")).toBe("rows");
  });

  it("overwrites rather than accumulating", () => {
    const data = stubStorage();
    saveViewMode("ANIME", "rows");
    saveViewMode("ANIME", "grid");
    expect(loadViewMode("ANIME")).toBe("grid");
    expect(JSON.parse(data.get(KEY)!)).toEqual({ ANIME: "grid" });
  });

  // --- The reason this is a module and not two inline localStorage calls.

  it("falls back on malformed JSON", () => {
    stubStorage({ [KEY]: "{not json" });
    expect(loadViewMode("ANIME")).toBe(DEFAULT_VIEW);
  });

  it("falls back on a value that is not a mode", () => {
    stubStorage({ [KEY]: JSON.stringify({ ANIME: "table", MANGA: 7 }) });
    expect(loadViewMode("ANIME")).toBe(DEFAULT_VIEW);
    expect(loadViewMode("MANGA")).toBe(DEFAULT_VIEW);
  });

  it("ignores a stored shape that is not an object", () => {
    for (const bad of ["null", "[]", '"rows"', "42"]) {
      stubStorage({ [KEY]: bad });
      expect(loadViewMode("ANIME")).toBe(DEFAULT_VIEW);
    }
  });

  /** A bad neighbour must not cost a good one. */
  it("keeps the valid entries beside an invalid one", () => {
    stubStorage({ [KEY]: JSON.stringify({ ANIME: "rows", MANGA: "nonsense" }) });
    expect(loadViewMode("ANIME")).toBe("rows");
    expect(loadViewMode("MANGA")).toBe(DEFAULT_VIEW);
  });

  /**
   * Private-mode localStorage throws on access, not just on write. Losing the
   * preference is fine; taking the screen down with it is not.
   */
  it("survives a storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(loadViewMode("ANIME")).toBe(DEFAULT_VIEW);
    expect(() => saveViewMode("ANIME", "rows" as ViewMode)).not.toThrow();
  });
});
