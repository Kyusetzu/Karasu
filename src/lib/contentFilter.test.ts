import { describe, expect, it } from "vitest";
import {
  adultQueryArg,
  isBlocked,
  isBlockedGenre,
  toLevel,
} from "./contentFilter";

const hentai = { isAdult: true, genres: ["Hentai"] };
const ecchi = { isAdult: false, genres: ["Comedy", "Ecchi"] };
const plain = { isAdult: false, genres: ["Action", "Drama"] };

describe("isBlocked", () => {
  it("hides nothing when off", () => {
    expect(isBlocked(hentai, "off")).toBe(false);
    expect(isBlocked(ecchi, "off")).toBe(false);
  });

  it("hides adult but allows ecchi at moderate", () => {
    expect(isBlocked(hentai, "moderate")).toBe(true);
    expect(isBlocked(ecchi, "moderate")).toBe(false);
    expect(isBlocked(plain, "moderate")).toBe(false);
  });

  it("hides adult and ecchi at strict", () => {
    expect(isBlocked(hentai, "strict")).toBe(true);
    expect(isBlocked(ecchi, "strict")).toBe(true);
    expect(isBlocked(plain, "strict")).toBe(false);
  });

  it("matches genres case-insensitively", () => {
    expect(isBlocked({ genres: ["ECCHI"] }, "strict")).toBe(true);
    expect(isBlocked({ genres: ["ecchi"] }, "strict")).toBe(true);
  });

  it("treats missing fields as not blocked", () => {
    expect(isBlocked({}, "strict")).toBe(false);
    expect(isBlocked(null, "strict")).toBe(false);
    expect(isBlocked(undefined, "strict")).toBe(false);
    expect(isBlocked({ isAdult: null, genres: null }, "strict")).toBe(false);
  });

  it("hides adult titles even when genres are absent", () => {
    expect(isBlocked({ isAdult: true }, "moderate")).toBe(true);
  });
});

describe("isBlockedGenre", () => {
  it("hides hentai at both filtering levels", () => {
    expect(isBlockedGenre("Hentai", "moderate")).toBe(true);
    expect(isBlockedGenre("Hentai", "strict")).toBe(true);
    expect(isBlockedGenre("Hentai", "off")).toBe(false);
  });

  it("hides ecchi only at strict", () => {
    expect(isBlockedGenre("Ecchi", "moderate")).toBe(false);
    expect(isBlockedGenre("Ecchi", "strict")).toBe(true);
  });

  it("leaves ordinary genres alone", () => {
    expect(isBlockedGenre("Action", "strict")).toBe(false);
  });
});

describe("adultQueryArg", () => {
  it("omits the argument when off, else requests non-adult", () => {
    expect(adultQueryArg("off")).toBeUndefined();
    expect(adultQueryArg("moderate")).toBe(false);
    expect(adultQueryArg("strict")).toBe(false);
  });
});

describe("toLevel", () => {
  it("passes through valid levels", () => {
    expect(toLevel("off")).toBe("off");
    expect(toLevel("moderate")).toBe("moderate");
    expect(toLevel("strict")).toBe("strict");
  });

  it("defaults to strict for anything unrecognised", () => {
    expect(toLevel(null)).toBe("strict");
    expect(toLevel(undefined)).toBe("strict");
    expect(toLevel("")).toBe("strict");
    expect(toLevel("nonsense")).toBe("strict");
  });
});
