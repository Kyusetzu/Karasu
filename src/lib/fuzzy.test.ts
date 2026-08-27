import { describe, expect, it } from "vitest";
import {
  dice,
  fuzzyScore,
  normalize,
  prepareDoc,
  prepareQuery,
  trigrams,
} from "./fuzzy";

const score = (titles: (string | null)[], q: string) =>
  fuzzyScore(prepareDoc(titles), prepareQuery(q));

describe("normalize", () => {
  it("lowercases, folds diacritics and strips punctuation", () => {
    expect(normalize("Pokémon: The Movie!")).toBe("pokemon the movie");
  });

  it("passes kana and kanji through unharmed", () => {
    expect(normalize("進撃の巨人")).toBe("進撃の巨人");
  });

  it("collapses whitespace runs", () => {
    expect(normalize("  a  -  b  ")).toBe("a b");
  });
});

describe("dice", () => {
  it("guards the empty set instead of producing NaN", () => {
    expect(dice(new Set(), new Set())).toBe(0);
    expect(dice(trigrams("abc"), new Set())).toBe(0);
  });

  it("is 1 for identical sets", () => {
    expect(dice(trigrams("monster"), trigrams("monster"))).toBe(1);
  });
});

describe("fuzzyScore tiers", () => {
  it("orders exact > substring > token-prefix > trigram", () => {
    const exact = score(["Frieren"], "frieren");
    const substring = score(["Sousou no Frieren"], "frieren");
    const prefix = score(["Kimetsu no Yaiba"], "kimetsu yaiba");
    const fuzzy = score(["Kimetsu no Yaiba"], "kimetsu no yaeba");
    expect(exact).toBe(1);
    expect(substring).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
  });

  it("finds a title with the particle dropped", () => {
    expect(score(["Kimetsu no Yaiba"], "kimetsu yaiba")).toBeGreaterThan(0.6);
  });

  it("tolerates a one-letter typo", () => {
    expect(score(["Kimetsu no Yaiba"], "kimetsu no yaeba")).toBeGreaterThan(0);
  });

  it("matches short prefixes without the trigram path", () => {
    expect(score(["Frieren"], "fr")).toBeGreaterThan(0);
    expect(score(["Bleach"], "fr")).toBe(0);
  });

  it("folds diacritics on both sides", () => {
    expect(score(["Pokémon"], "pokemon")).toBe(1);
  });

  it("matches a kana substring", () => {
    expect(score(["進撃の巨人"], "進撃")).toBeGreaterThan(0.8);
  });

  it("ranks the tighter title higher on a substring hit", () => {
    const tight = score(["Monster"], "monster");
    const loose = score(["Monster Musume no Iru Nichijou"], "monster");
    expect(tight).toBeGreaterThan(loose);
  });

  it("never matches across two titles of one entry", () => {
    // The straddle bug the old NUL-joined haystack existed to prevent: joined
    // with a space, "titan bleach" would match this entry.
    expect(score(["Attack on Titan", "Bleach"], "titan bleach")).toBe(0);
  });

  it("scores each synonym independently", () => {
    expect(score(["Shingeki no Kyojin", "Attack on Titan"], "attack")).toBeGreaterThan(0);
  });

  it("returns 0 for an empty query and an empty doc", () => {
    expect(score(["Monster"], "")).toBe(0);
    expect(score(["Monster"], "  ...  ")).toBe(0);
    expect(score([], "monster")).toBe(0);
    expect(score([null, ""], "monster")).toBe(0);
  });

  it("does not let a repeated query word double-claim one title word", () => {
    // "steins steins" may still match on trigrams — "steins" really is in the
    // title — but it must not earn the token-prefix tier by matching the same
    // title word twice.
    expect(score(["Steins;Gate"], "steins steins")).toBeLessThan(0.6);
  });
});
