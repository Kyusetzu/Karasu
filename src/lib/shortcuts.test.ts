import { describe, expect, it } from "vitest";
import { PALETTE_SHORTCUTS, SHORTCUT_SCOPES, SHORTCUTS, shortcutKeys, shortcutsIn } from "./shortcuts";

describe("shortcuts", () => {
  it("lists each shortcut once", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never binds one key combination twice where both would answer", () => {
    // A global shortcut also answers on a list screen and in a composer, so it shares each of their spaces.
    for (const scope of SHORTCUT_SCOPES) {
      const live = SHORTCUTS.filter((s) => s.scope === scope || s.scope === "global");
      const combos = live.map((s) => s.keys.join("+"));
      expect(new Set(combos).size, scope).toBe(combos.length);
    }
  });

  it("gives every scope at least one shortcut and every shortcut at least one key", () => {
    for (const scope of SHORTCUT_SCOPES) expect(shortcutsIn(scope).length, scope).toBeGreaterThan(0);
    for (const s of SHORTCUTS) expect(s.keys.length, s.id).toBeGreaterThan(0);
  });

  it("shows the palette only shortcuts that exist and answer outside a composer", () => {
    for (const id of PALETTE_SHORTCUTS) {
      const s = SHORTCUTS.find((x) => x.id === id);
      expect(s, id).toBeDefined();
      expect(s?.scope, id).not.toBe("inComposer");
    }
  });

  it("reads a shortcut's keys by its id", () => {
    expect(shortcutKeys("sync")).toEqual(["Ctrl", "R"]);
    expect(shortcutKeys("reference")).toEqual(["?"]);
    expect(shortcutKeys("palette")).toEqual(["Ctrl", "K"]);
  });
});
