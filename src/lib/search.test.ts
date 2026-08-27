import { describe, expect, it } from "vitest";
import { searchTitles } from "./search";

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

describe("searchTitles", () => {
  it("includes every title and synonym, in display order", () => {
    expect(
      searchTitles(
        media(
          { romaji: "Shingeki no Kyojin", english: "Attack on Titan", native: "進撃の巨人" },
          ["AoT", "SnK"],
        ),
      ),
    ).toEqual(["Shingeki no Kyojin", "Attack on Titan", "進撃の巨人", "AoT", "SnK"]);
  });

  it("drops missing titles instead of leaving holes", () => {
    expect(searchTitles(media({ romaji: "Monster" }))).toEqual(["Monster"]);
  });

  it("handles an entry with no titles at all", () => {
    expect(searchTitles(media({}))).toEqual([]);
  });
});
