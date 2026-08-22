import { describe, expect, it } from "vitest";
import {
  adultQueryArg,
  isBlocked,
  isBlockedGenre,
  toLevel,
  shouldBlur,
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

describe("shouldBlur", () => {
  const adult = { isAdult: true, genres: ["Hentai"] };
  const ecchi = { isAdult: false, genres: ["Ecchi"] };
  const plain = { isAdult: false, genres: ["Action"] };

  /** The case it exists for: filter Off, so the title is on screen, but the
   *  artwork should not arrive unannounced. */
  it("veils an explicit title when the filter lets it through", () => {
    expect(shouldBlur(adult, "off", true)).toBe(true);
  });

  it("does nothing when the setting is off", () => {
    expect(shouldBlur(adult, "off", false)).toBe(false);
  });

  /** Ecchi is an ordinary genre — blurring it would blur a large slice of an
   *  ordinary list, which is the level's job to decide, not this one's. */
  it("only ever veils isAdult, never a suggestive genre", () => {
    expect(shouldBlur(ecchi, "off", true)).toBe(false);
    expect(shouldBlur(plain, "off", true)).toBe(false);
  });

  it("survives a missing media object", () => {
    expect(shouldBlur(null, "off", true)).toBe(false);
    expect(shouldBlur(undefined, "off", true)).toBe(false);
    expect(shouldBlur({}, "off", true)).toBe(false);
  });

  /**
   * The two levels the suite never asked about, and the reason the last line
   * of `shouldBlur` is not the tautology it looks like.
   *
   * At moderate and strict an adult title is excluded server-side and never
   * reaches a render site — so this is unreachable in practice. It still has to
   * answer *veil* rather than *bare*, because the one way it becomes reachable
   * is a render site that forgot `isBlocked`, and failing open there would show
   * the artwork to precisely the person who set the filter to strict.
   */
  it("still veils at moderate and strict, where it should never be asked", () => {
    expect(shouldBlur(adult, "moderate", true)).toBe(true);
    expect(shouldBlur(adult, "strict", true)).toBe(true);
  });

  it("respects the setting at every level, not just off", () => {
    expect(shouldBlur(adult, "moderate", false)).toBe(false);
    expect(shouldBlur(adult, "strict", false)).toBe(false);
  });
});
