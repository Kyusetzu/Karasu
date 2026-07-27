import { describe, expect, it } from "vitest";
import { searchHaystack } from "./search";

const media = (
  title: { romaji?: string; english?: string; native?: string },
  synonyms: string[] = [],
) => ({
  title: {
    romaji: title.romaji ?? null,
    english: title.english ?? null,
    native: title.native ?? null,
  },
  synonyms,
});

describe("searchHaystack", () => {
  it("includes every title and synonym, lowercased", () => {
    const hay = searchHaystack(
      media(
        { romaji: "Shingeki no Kyojin", english: "Attack on Titan", native: "進撃の巨人" },
        ["AoT", "SnK"],
      ),
    );
    for (const needle of [
      "shingeki no kyojin",
      "attack on titan",
      "進撃の巨人",
      "aot",
      "snk",
    ]) {
      expect(hay).toContain(needle);
    }
  });

  it("drops missing titles instead of leaving holes", () => {
    expect(searchHaystack(media({ romaji: "Monster" }))).toBe("monster");
  });

  it("never lets a query match across two titles", () => {
    // Joined with a space this would match "titan bleach".
    const hay = searchHaystack(media({ english: "Attack on Titan" }, ["Bleach"]));
    expect(hay).toContain("titan");
    expect(hay).toContain("bleach");
    expect(hay).not.toContain("titan bleach");
  });

  it("handles an entry with no titles at all", () => {
    expect(searchHaystack(media({}))).toBe("");
  });
});
