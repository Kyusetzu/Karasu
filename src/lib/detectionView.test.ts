import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DETECTION_VIEW,
  loadDetectionView,
  saveDetectionView,
} from "@/lib/detectionView";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    configurable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("detectionView", () => {
  it("starts expanded, since the card arrives unprompted and has to be readable", () => {
    expect(loadDetectionView()).toBe(DEFAULT_DETECTION_VIEW);
    expect(DEFAULT_DETECTION_VIEW).toBe("expanded");
  });

  it("round-trips the choice", () => {
    saveDetectionView("compact");
    expect(loadDetectionView()).toBe("compact");
    saveDetectionView("expanded");
    expect(loadDetectionView()).toBe("expanded");
  });

  it("falls back rather than trusting a stale value", () => {
    store.set("karasu-detection-view", "gigantic");
    expect(loadDetectionView()).toBe(DEFAULT_DETECTION_VIEW);
  });

  it("survives storage that throws, as private mode's does", () => {
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
    expect(loadDetectionView()).toBe(DEFAULT_DETECTION_VIEW);
    expect(() => saveDetectionView("compact")).not.toThrow();
  });
});
