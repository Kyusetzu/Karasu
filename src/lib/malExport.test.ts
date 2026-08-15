import { describe, expect, it } from "vitest";
import type { MediaListEntry } from "@/api/types";
import { buildJsonExport, buildMalXml, cdata, malDate } from "./malExport";

const entry = (over: Record<string, unknown> = {}): MediaListEntry =>
  ({
    id: 1,
    mediaId: 10,
    status: "CURRENT",
    score: 8,
    progress: 5,
    progressVolumes: 0,
    repeat: 0,
    notes: null,
    updatedAt: 0,
    private: false,
    startedAt: { year: 2024, month: 3, day: 9 },
    completedAt: null,
    media: {
      id: 10,
      idMal: 5114,
      title: { romaji: "Hagane no Renkinjutsushi", english: "Fullmetal Alchemist", native: null },
      coverImage: { large: null },
      episodes: 64,
      chapters: null,
      volumes: null,
      format: "TV",
      status: "FINISHED",
      season: null,
      seasonYear: null,
      averageScore: null,
      genres: [],
      synonyms: [],
      nextAiringEpisode: null,
    },
    ...over,
  }) as MediaListEntry;

describe("buildMalXml", () => {
  it("writes an anime row MAL's importer understands", () => {
    const { xml, count, skipped } = buildMalXml([entry()], "ANIME", "POINT_10");
    expect(count).toBe(1);
    expect(skipped).toBe(0);
    expect(xml).toContain("<user_export_type>1</user_export_type>");
    expect(xml).toContain("<series_animedb_id>5114</series_animedb_id>");
    expect(xml).toContain("<my_watched_episodes>5</my_watched_episodes>");
    expect(xml).toContain("<my_start_date>2024-03-09</my_start_date>");
    expect(xml).toContain("<my_finish_date>0000-00-00</my_finish_date>");
    // POINT_10's 8 is raw 80, which is MAL's 8 — the identity case.
    expect(xml).toContain("<my_score>8</my_score>");
    expect(xml).toContain("<my_status>Watching</my_status>");
  });

  it("converts scores through the raw scale, whatever the account format", () => {
    // A 5-star account's 4 is raw 80 (`toRaw` is the authority) → MAL 8.
    const { xml } = buildMalXml([entry({ score: 4 })], "ANIME", "POINT_5");
    expect(xml).toContain("<my_score>8</my_score>");
  });

  it("counts a title MAL has never heard of instead of exporting it", () => {
    const noMal = entry();
    noMal.media = { ...noMal.media, idMal: null };
    const { count, skipped, xml } = buildMalXml([noMal, entry()], "ANIME", "POINT_10");
    expect(count).toBe(1);
    expect(skipped).toBe(1);
    expect(xml).toContain("<user_total_anime>1</user_total_anime>");
  });

  /**
   * The MAL export is the one that hands the list to someone else, so it is
   * the one where "private" has to bite. Counted separately from `skipped`:
   * missing a MAL id is a limit of the format, private is a choice.
   */
  it("leaves a private entry out and says how many", () => {
    const secret = entry({ private: true });
    const { count, skipped, omitted, xml } = buildMalXml(
      [secret, entry()],
      "ANIME",
      "POINT_10",
    );
    expect(count).toBe(1);
    expect(omitted).toBe(1);
    expect(skipped).toBe(0);
    expect(xml).toContain("<user_total_anime>1</user_total_anime>");
  });

  /** The backup keeps everything — a backup that drops rows is not one. */
  it("keeps a private entry in the JSON export, flagged", () => {
    const json = JSON.parse(
      buildJsonExport([entry({ private: true })], [], "POINT_10", 0),
    );
    expect(json.anime).toHaveLength(1);
    expect(json.anime[0].private).toBe(true);
  });

  it("maps every status, and REPEATING to the active one", () => {
    const at = (status: string) =>
      buildMalXml([entry({ status })], "ANIME", "POINT_10").xml.match(
        /<my_status>(.*)<\/my_status>/,
      )?.[1];
    expect(at("REPEATING")).toBe("Watching");
    expect(at("PLANNING")).toBe("Plan to Watch");
    expect(at("PAUSED")).toBe("On-Hold");
    expect(at("DROPPED")).toBe("Dropped");
    expect(at("COMPLETED")).toBe("Completed");
  });

  it("writes manga rows with both progress axes and manga vocabulary", () => {
    const m = entry({ status: "CURRENT", progress: 120, progressVolumes: 13 });
    m.media = { ...m.media, chapters: 139, volumes: 14 };
    const { xml } = buildMalXml([m], "MANGA", "POINT_10");
    expect(xml).toContain("<user_export_type>2</user_export_type>");
    expect(xml).toContain("<manga_mangadb_id>5114</manga_mangadb_id>");
    expect(xml).toContain("<my_read_chapters>120</my_read_chapters>");
    expect(xml).toContain("<my_read_volumes>13</my_read_volumes>");
    expect(xml).toContain("<my_status>Reading</my_status>");
  });
});

describe("malDate", () => {
  it("zero-pads a full date and nulls a partial one", () => {
    expect(malDate({ year: 2024, month: 3, day: 9 })).toBe("2024-03-09");
    // MAL has no partial dates; a guessed day would be a fabrication.
    expect(malDate({ year: 2024, month: null, day: null })).toBe("0000-00-00");
    expect(malDate({ year: 2024, month: 3, day: null })).toBe("0000-00-00");
    expect(malDate(null)).toBe("0000-00-00");
  });
});

describe("cdata", () => {
  it("splits its own terminator so a hostile title cannot escape", () => {
    expect(cdata("a]]>b")).toBe("<![CDATA[a]]]]><![CDATA[>b]]>");
    expect(cdata("plain")).toBe("<![CDATA[plain]]>");
  });
});

describe("buildJsonExport", () => {
  it("exports raw scores beside the format, and trims media to identity", () => {
    const out = JSON.parse(
      buildJsonExport([entry({ score: 4 })], [], "POINT_5", 1_700_000_000_000),
    );
    expect(out.source).toBe("karasu");
    expect(out.scoreFormat).toBe("POINT_5");
    expect(out.exportedAt).toBe("2023-11-14T22:13:20.000Z");
    expect(out.anime[0].scoreRaw).toBe(80);
    expect(out.anime[0].media).toEqual({
      id: 10,
      idMal: 5114,
      title: { romaji: "Hagane no Renkinjutsushi", english: "Fullmetal Alchemist", native: null },
      format: "TV",
      episodes: 64,
      chapters: null,
      volumes: null,
    });
    expect(out.anime[0].media.coverImage).toBeUndefined();
    expect(out.manga).toEqual([]);
  });
});
