import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLegendOpen, saveLegendOpen } from "@/lib/franchiseLegend";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    configurable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("franchiseLegend", () => {
  it("starts closed", () => {
    expect(loadLegendOpen()).toBe(false);
  });

  it("round-trips the choice", () => {
    saveLegendOpen(true);
    expect(loadLegendOpen()).toBe(true);
    saveLegendOpen(false);
    expect(loadLegendOpen()).toBe(false);
  });

  it("reads anything unexpected as closed", () => {
    store.set("karasu-franchise-legend", "sideways");
    expect(loadLegendOpen()).toBe(false);
  });

  it("stays closed, and the toggle survives, when storage throws", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
      },
      configurable: true,
    });
    expect(loadLegendOpen()).toBe(false);
    expect(() => saveLegendOpen(true)).not.toThrow();
  });
});
