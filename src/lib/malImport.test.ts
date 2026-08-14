import { describe, expect, it } from "vitest";
import { buildMalXml } from "./malExport";
import { parseMalDate, parseMalStatus, parseMalXml } from "./malImport";
import type { MediaListEntry } from "@/api/types";

const XML = `<?xml version="1.0" encoding="UTF-8" ?>
<myanimelist>
\t<myinfo>
\t\t<user_export_type>1</user_export_type>
\t</myinfo>
\t<anime>
\t\t<series_animedb_id>5114</series_animedb_id>
\t\t<series_title><![CDATA[Fullmetal Alchemist: Brotherhood]]></series_title>
\t\t<series_episodes>64</series_episodes>
\t\t<my_watched_episodes>40</my_watched_episodes>
\t\t<my_start_date>2024-03-00</my_start_date>
\t\t<my_finish_date>0000-00-00</my_finish_date>
\t\t<my_score>9</my_score>
\t\t<my_status>Watching</my_status>
\t\t<my_times_watched>1</my_times_watched>
\t</anime>
\t<anime>
\t\t<series_animedb_id>0</series_animedb_id>
\t\t<series_title><![CDATA[Some hoarded special]]></series_title>
\t\t<my_status>Completed</my_status>
\t</anime>
</myanimelist>`;

describe("parseMalXml", () => {
  it("reads MAL's own vocabulary back into AniList's", () => {
    const out = parseMalXml(XML);
    expect(out.type).toBe("ANIME");
    expect(out.skipped).toBe(1);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toEqual({
      idMal: 5114,
      title: "Fullmetal Alchemist: Brotherhood",
      status: "CURRENT",
      score: 9,
      progress: 40,
      progressVolumes: 0,
      repeat: 1,
      // A zero day keeps the parts MAL did record.
      startedAt: { year: 2024, month: 3, day: null },
      completedAt: null,
    });
  });

  it("decides the medium by the blocks, not the header", () => {
    const manga = `<myanimelist><myinfo><user_export_type>1</user_export_type></myinfo>
<manga><manga_mangadb_id>30</manga_mangadb_id><manga_title><![CDATA[Berserk]]></manga_title>
<my_read_chapters>200</my_read_chapters><my_read_volumes>20</my_read_volumes>
<my_status>Reading</my_status><my_score>10</my_score></manga></myanimelist>`;
    const out = parseMalXml(manga);
    expect(out.type).toBe("MANGA");
    expect(out.rows[0]).toMatchObject({
      idMal: 30,
      progress: 200,
      progressVolumes: 20,
      status: "CURRENT",
    });
  });

  it("decodes entities and clamps a score outside MAL's own scale", () => {
    const odd = `<myanimelist><anime><series_animedb_id>1</series_animedb_id>
<series_title>Steins;Gate &amp; friends &lt;3</series_title>
<my_status>On-Hold</my_status><my_score>99</my_score></anime></myanimelist>`;
    const out = parseMalXml(odd);
    expect(out.rows[0].title).toBe("Steins;Gate & friends <3");
    expect(out.rows[0].status).toBe("PAUSED");
    expect(out.rows[0].score).toBe(10);
  });

  it("round-trips Karasu's own export", () => {
    const entry = {
      id: 1,
      mediaId: 10,
      status: "PAUSED",
      score: 7,
      progress: 5,
      progressVolumes: 0,
      repeat: 2,
      notes: null,
      updatedAt: 0,
      private: false,
      startedAt: { year: 2023, month: 12, day: 24 },
      completedAt: null,
      media: {
        id: 10,
        idMal: 44511,
        title: { romaji: "Chainsaw Man", english: null, native: null },
        coverImage: { large: null },
        episodes: 12,
        format: "TV",
        status: "FINISHED",
        season: null,
        seasonYear: null,
        averageScore: null,
        genres: [],
        synonyms: [],
        nextAiringEpisode: null,
      },
    } as unknown as MediaListEntry;
    const { xml } = buildMalXml([entry], "ANIME", "POINT_10");
    const back = parseMalXml(xml);
    expect(back.rows).toEqual([
      {
        idMal: 44511,
        title: "Chainsaw Man",
        status: "PAUSED",
        score: 7,
        progress: 5,
        progressVolumes: 0,
        repeat: 2,
        startedAt: { year: 2023, month: 12, day: 24 },
        completedAt: null,
      },
    ]);
  });
});

describe("parseMalDate", () => {
  it("reads full, partial and null dates", () => {
    expect(parseMalDate("2024-03-09")).toEqual({ year: 2024, month: 3, day: 9 });
    expect(parseMalDate("2024-00-00")).toEqual({ year: 2024, month: null, day: null });
    expect(parseMalDate("0000-00-00")).toBeNull();
    expect(parseMalDate("garbage")).toBeNull();
    expect(parseMalDate(null)).toBeNull();
  });
});

describe("parseMalStatus", () => {
  it("covers both media vocabularies and rejects the unknown", () => {
    expect(parseMalStatus("Watching")).toBe("CURRENT");
    expect(parseMalStatus("reading")).toBe("CURRENT");
    expect(parseMalStatus("Plan to Read")).toBe("PLANNING");
    expect(parseMalStatus("On-Hold")).toBe("PAUSED");
    expect(parseMalStatus("Mysterious")).toBeNull();
    expect(parseMalStatus(null)).toBeNull();
  });
});
