import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ADD_STATUS,
  loadDefaultAddStatus,
  saveDefaultAddStatus,
} from "./defaultAddStatus";

const KEY = "karasu-default-add-status";

/** The same stand-in `viewMode.test.ts` uses — vitest runs without a DOM. */
function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
  return data;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("defaultAddStatus", () => {
  it("defaults to Planning", () => {
    stubStorage();
    expect(loadDefaultAddStatus()).toBe(DEFAULT_ADD_STATUS);
  });

  it("round-trips a chosen status", () => {
    const data = stubStorage();
    saveDefaultAddStatus("CURRENT");
    expect(data.get(KEY)).toBe("CURRENT");
    expect(loadDefaultAddStatus()).toBe("CURRENT");
  });

  it("falls back on a value that is not a status", () => {
    stubStorage({ [KEY]: "WISHLISTED" });
    expect(loadDefaultAddStatus()).toBe(DEFAULT_ADD_STATUS);
  });

  it("survives a storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(loadDefaultAddStatus()).toBe(DEFAULT_ADD_STATUS);
    expect(() => saveDefaultAddStatus("PAUSED")).not.toThrow();
  });
});
