import { describe, expect, it } from "vitest";
import {
  isNamedColor,
  normalizeProfileColor,
  PROFILE_COLOR_HEX,
  PROFILE_COLORS,
  profileColorSwatch,
} from "./profileColor";

describe("PROFILE_COLORS", () => {
  it("holds the seven names observed on real accounts", () => {
    // Sampled across fifty accounts: pink, orange, green, purple, red, gray, blue.
    expect([...PROFILE_COLORS].sort()).toEqual(
      ["blue", "gray", "green", "orange", "pink", "purple", "red"].sort(),
    );
  });

  it("has a swatch for every name", () => {
    for (const name of PROFILE_COLORS) {
      expect(PROFILE_COLOR_HEX[name], name).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("normalizeProfileColor", () => {
  it("accepts the names, lowercased", () => {
    expect(normalizeProfileColor("blue")).toBe("blue");
    expect(normalizeProfileColor("PINK")).toBe("pink");
    expect(normalizeProfileColor("  Green  ")).toBe("green");
  });

  it("accepts six-digit hex, uppercased to match what AniList returns", () => {
    // Both of these are real values from live accounts.
    expect(normalizeProfileColor("#FF0000")).toBe("#FF0000");
    expect(normalizeProfileColor("#e6d0ff")).toBe("#E6D0FF");
  });

  it("rejects three-digit hex rather than expanding it", () => {
    // Expanding would send a value the user did not type, and AniList returns
    // six digits, so there is nothing to be compatible with.
    expect(normalizeProfileColor("#abc")).toBeNull();
  });

  it("rejects anything else", () => {
    for (const bad of [
      "", "   ", null, undefined, "turquoise", "rgb(1,2,3)", "#12345", "#1234567",
      "blue;", "javascript:alert(1)", "#GGGGGG",
    ]) {
      expect(normalizeProfileColor(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("is idempotent, so a round trip does not read as a change", () => {
    for (const v of ["blue", "#FF0000", "PINK", "#e6d0ff"]) {
      const once = normalizeProfileColor(v);
      expect(normalizeProfileColor(once)).toBe(once);
    }
  });
});

describe("isNamedColor", () => {
  it("separates names from hex", () => {
    expect(isNamedColor("blue")).toBe(true);
    expect(isNamedColor("BLUE")).toBe(true);
    expect(isNamedColor("#FF0000")).toBe(false);
    expect(isNamedColor(null)).toBe(false);
    expect(isNamedColor("nonsense")).toBe(false);
  });
});

describe("profileColorSwatch", () => {
  it("maps a name to AniList's palette value", () => {
    expect(profileColorSwatch("blue")).toBe(PROFILE_COLOR_HEX.blue);
    expect(profileColorSwatch("GRAY")).toBe(PROFILE_COLOR_HEX.gray);
  });

  it("passes a hex value through", () => {
    expect(profileColorSwatch("#e6d0ff")).toBe("#E6D0FF");
  });

  it("gives nothing to paint for an unusable value", () => {
    expect(profileColorSwatch("turquoise")).toBeNull();
    expect(profileColorSwatch(null)).toBeNull();
  });
});
