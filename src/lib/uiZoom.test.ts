import { describe, expect, it } from "vitest";
import { stepZoom, UI_ZOOM_DEFAULT, UI_ZOOM_STEPS, zoomShortcut } from "./uiZoom";

describe("stepZoom", () => {
  it("walks the steps in both directions and stops at the ends", () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(110, -1)).toBe(100);
    expect(stepZoom(200, 1)).toBe(200);
    expect(stepZoom(75, -1)).toBe(75);
  });

  it("moves an off-list value to the nearest step in the asked direction", () => {
    // A value between steps must not snap the wrong way first.
    expect(stepZoom(105, 1)).toBe(110);
    expect(stepZoom(105, -1)).toBe(100);
    expect(stepZoom(10, 1)).toBe(UI_ZOOM_STEPS[0]);
    expect(stepZoom(999, -1)).toBe(UI_ZOOM_STEPS[UI_ZOOM_STEPS.length - 1]);
  });

  it("keeps the default on the list", () => {
    expect(UI_ZOOM_STEPS).toContain(UI_ZOOM_DEFAULT);
  });
});

describe("zoomShortcut", () => {
  const key = (over: Partial<Parameters<typeof zoomShortcut>[0]>) =>
    zoomShortcut({ key: "", code: "", ctrlKey: true, metaKey: false, altKey: false, ...over });

  it("reads Ctrl with plus, equals, minus and zero, main row and numpad", () => {
    expect(key({ key: "+" })).toBe("in");
    expect(key({ key: "=", code: "Equal" })).toBe("in");
    expect(key({ key: "+", code: "NumpadAdd" })).toBe("in");
    expect(key({ key: "-" })).toBe("out");
    expect(key({ key: "-", code: "NumpadSubtract" })).toBe("out");
    expect(key({ key: "0" })).toBe("reset");
    expect(key({ key: "0", code: "Numpad0" })).toBe("reset");
  });

  it("ignores the keys without Ctrl, and Ctrl+Alt (AltGr on Windows)", () => {
    expect(key({ key: "+", ctrlKey: false })).toBeNull();
    expect(key({ key: "+", altKey: true })).toBeNull();
    expect(key({ key: "k" })).toBeNull();
  });
});
