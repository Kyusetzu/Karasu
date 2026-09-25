import { beforeEach, describe, expect, it } from "vitest";
import { loadPresets, savePresets, type Preset } from "./presets";

// Minimal in-memory localStorage so these pure helpers run under node.
beforeEach(() => {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

const preset: Preset = { name: "Airing", tab: "CURRENT", filter: "", sort: "updated" };

describe("presets", () => {
  it("returns an empty list before anything is saved", () => {
    expect(loadPresets("ANIME")).toEqual([]);
  });

  it("round-trips presets per media type", () => {
    savePresets("ANIME", [preset]);
    expect(loadPresets("ANIME")).toEqual([preset]);
    // A different media type is isolated.
    expect(loadPresets("MANGA")).toEqual([]);
  });

  it("does not mix media types", () => {
    savePresets("ANIME", [preset]);
    savePresets("MANGA", [{ ...preset, name: "Reading" }]);
    expect(loadPresets("ANIME")[0].name).toBe("Airing");
    expect(loadPresets("MANGA")[0].name).toBe("Reading");
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("karasu-presets", "{not json");
    expect(loadPresets("ANIME")).toEqual([]);
  });

  /** An older preset loads with the filter fields absent, and the apply site's `?? ""` reads absence as "clear". */
  it("loads legacy presets without the newer filter fields", () => {
    localStorage.setItem(
      "karasu-presets",
      JSON.stringify({ ANIME: [{ name: "Old", tab: "CURRENT", filter: "", sort: "updated" }] }),
    );
    const [p] = loadPresets("ANIME");
    expect(p.name).toBe("Old");
    expect(p.format).toBeUndefined();
    expect(p.country).toBeUndefined();
    expect(p.tagFilter).toBeUndefined();
    expect(p.list).toBeUndefined();
  });

  it("round-trips the filter fields when present", () => {
    const full: Preset = { ...preset, name: "Movies", format: "MOVIE", country: "", tagFilter: "gem", list: "Favourites" };
    savePresets("ANIME", [full]);
    expect(loadPresets("ANIME")[0]).toEqual(full);
  });
});
