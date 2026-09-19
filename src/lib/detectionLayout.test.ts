import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DETECTION_LAYOUT,
  DEFAULT_DETECTION_WIDTH,
  DETECTION_MARGIN,
  DETECTION_MAX_WIDTH,
  DETECTION_MIN_WIDTH,
  clampPosition,
  clampWidth,
  dragPosition,
  loadDetectionLayout,
  pastThreshold,
  resizeWidth,
  saveDetectionLayout,
} from "@/lib/detectionLayout";

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

const viewport = { width: 1280, height: 800 };
const size = { width: 352, height: 160 };

describe("detectionLayout storage", () => {
  it("starts docked at the docked width", () => {
    expect(loadDetectionLayout()).toEqual(DEFAULT_DETECTION_LAYOUT);
    expect(DEFAULT_DETECTION_LAYOUT.position).toBeNull();
    expect(DEFAULT_DETECTION_LAYOUT.width).toBe(DEFAULT_DETECTION_WIDTH);
  });

  it("round-trips a dragged position and a width", () => {
    saveDetectionLayout({ position: { left: 40, top: 60 }, width: 400 });
    expect(loadDetectionLayout()).toEqual({ position: { left: 40, top: 60 }, width: 400 });
    saveDetectionLayout({ position: null, width: 400 });
    expect(loadDetectionLayout()).toEqual({ position: null, width: 400 });
  });

  it("docks rather than guessing when the stored position is half there or garbage", () => {
    store.set("karasu-detection-layout", JSON.stringify({ left: 40, width: 400 }));
    expect(loadDetectionLayout()).toEqual({ position: null, width: 400 });
    store.set("karasu-detection-layout", JSON.stringify({ left: "40", top: 60, width: "wide" }));
    expect(loadDetectionLayout()).toEqual(DEFAULT_DETECTION_LAYOUT);
    store.set("karasu-detection-layout", "{not json");
    expect(loadDetectionLayout()).toEqual(DEFAULT_DETECTION_LAYOUT);
    store.set("karasu-detection-layout", "null");
    expect(loadDetectionLayout()).toEqual(DEFAULT_DETECTION_LAYOUT);
  });

  it("clamps a stored width into the card's own bounds", () => {
    store.set("karasu-detection-layout", JSON.stringify({ width: 9000 }));
    expect(loadDetectionLayout().width).toBe(DETECTION_MAX_WIDTH);
    store.set("karasu-detection-layout", JSON.stringify({ width: 10 }));
    expect(loadDetectionLayout().width).toBe(DETECTION_MIN_WIDTH);
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
    expect(loadDetectionLayout()).toEqual(DEFAULT_DETECTION_LAYOUT);
    expect(() => saveDetectionLayout({ position: null, width: 400 })).not.toThrow();
  });
});

describe("clampWidth", () => {
  it("holds the card between its minimum and maximum", () => {
    expect(clampWidth(100, 1280)).toBe(DETECTION_MIN_WIDTH);
    expect(clampWidth(400, 1280)).toBe(400);
    expect(clampWidth(2000, 1280)).toBe(DETECTION_MAX_WIDTH);
  });

  it("never asks for more than the viewport minus both margins, and never less than the minimum", () => {
    expect(clampWidth(500, 400)).toBe(400 - 2 * DETECTION_MARGIN);
    expect(clampWidth(500, 200)).toBe(DETECTION_MIN_WIDTH);
  });
});

describe("clampPosition", () => {
  it("keeps the whole card inside the viewport on every side", () => {
    expect(clampPosition({ left: -50, top: -50 }, size, viewport)).toEqual({
      left: DETECTION_MARGIN,
      top: DETECTION_MARGIN,
    });
    expect(clampPosition({ left: 5000, top: 5000 }, size, viewport)).toEqual({
      left: viewport.width - size.width - DETECTION_MARGIN,
      top: viewport.height - size.height - DETECTION_MARGIN,
    });
    expect(clampPosition({ left: 300, top: 200 }, size, viewport)).toEqual({ left: 300, top: 200 });
  });

  it("pins to the top-left margin when the viewport is smaller than the card", () => {
    expect(clampPosition({ left: 300, top: 200 }, size, { width: 200, height: 100 })).toEqual({
      left: DETECTION_MARGIN,
      top: DETECTION_MARGIN,
    });
  });
});

describe("dragPosition", () => {
  const origin = { pointer: { x: 700, y: 510 }, position: { left: 600, top: 500 } };

  it("moves the card by the pointer's travel", () => {
    expect(dragPosition(origin, { x: 650, y: 400 }, size, viewport)).toEqual({ left: 550, top: 390 });
  });

  it("stops at the margin", () => {
    expect(dragPosition(origin, { x: -500, y: -500 }, size, viewport)).toEqual({
      left: DETECTION_MARGIN,
      top: DETECTION_MARGIN,
    });
  });
});

describe("resizeWidth", () => {
  it("keeps the left edge still when the right edge is dragged", () => {
    expect(resizeWidth({ pointerX: 900, left: 600, width: 352 }, "right", 950, viewport)).toEqual({
      left: 600,
      width: 402,
    });
  });

  it("keeps the right edge still when the left edge is dragged", () => {
    const out = resizeWidth({ pointerX: 600, left: 600, width: 352 }, "left", 500, viewport);
    expect(out).toEqual({ left: 500, width: 452 });
    expect(out.left! + out.width).toBe(600 + 352);
  });

  it("leaves a docked card docked, since CSS holds its right edge", () => {
    expect(resizeWidth({ pointerX: 600, left: null, width: 352 }, "left", 500, viewport)).toEqual({
      left: null,
      width: 452,
    });
  });

  it("clamps the width and moves the left edge by the clamped amount only", () => {
    const out = resizeWidth({ pointerX: 600, left: 600, width: 352 }, "left", 1000, viewport);
    expect(out.width).toBe(DETECTION_MIN_WIDTH);
    expect(out.left! + out.width).toBe(600 + 352);
  });
});

describe("pastThreshold", () => {
  it("treats a tiny wobble as a press and a real move as a drag", () => {
    expect(pastThreshold(2, 0)).toBe(false);
    expect(pastThreshold(3, 0)).toBe(true);
    expect(pastThreshold(2, 2)).toBe(false);
    expect(pastThreshold(3, 3)).toBe(true);
  });
});
