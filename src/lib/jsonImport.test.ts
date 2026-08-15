import { describe, expect, it } from "vitest";
import { buildJsonExport } from "./malExport";
import { parseJsonExport } from "./jsonImport";
import type { MediaListEntry } from "@/api/types";

const entry = (over: Record<string, unknown> = {}): MediaListEntry =>
  ({
    id: 1,
    mediaId: 10,
    status: "CURRENT",
    score: 8,
    progress: 5,
    progressVolumes: 0,
    repeat: 1,
    notes: "a note",
    updatedAt: 0,
    private: false,
    startedAt: { year: 2024, month: 3, day: 9 },
    completedAt: null,
    media: {
      id: 10,
      idMal: 5114,
      title: { romaji: "Frieren", english: null, native: null },
      format: "TV",
      episodes: 28,
      chapters: null,
      volumes: null,
    },
    ...over,
  }) as unknown as MediaListEntry;

describe("parseJsonExport", () => {
  /**
   * The property that matters: whatever the exporter writes, the importer
   * reads. Testing the two against each other rather than against a fixture is
   * what keeps them in step when the export shape changes.
   */
  it("reads back what the exporter wrote", () => {
    const json = buildJsonExport([entry()], [entry({ mediaId: 20 })], "POINT_10", 0);
    const out = parseJsonExport(json);
    expect(out.skipped).toBe(0);
    expect(out.rows).toHaveLength(2);

    const anime = out.rows.find((r) => r.mediaType === "ANIME")!;
    expect(anime.mediaId).toBe(10);
    expect(anime.title).toBe("Frieren");
    expect(anime.status).toBe("CURRENT");
    // Ten-point 8 is raw 80 — the format-independent number the export carries
    // precisely so this does not have to be guessed.
    expect(anime.scoreRaw).toBe(80);
    expect(anime.progress).toBe(5);
    expect(anime.repeat).toBe(1);
    expect(anime.notes).toBe("a note");
    expect(anime.startedAt).toEqual({ year: 2024, month: 3, day: 9 });
    expect(anime.completedAt).toBeNull();
  });

  /**
   * Local mode stores the media beside the row so the list renders with no
   * network at all — an import that dropped it would leave title-less cards
   * waiting on a fetch that never comes.
   */
  it("rebuilds enough media for a local row to render itself", () => {
    const json = buildJsonExport([entry()], [], "POINT_10", 0);
    const media = parseJsonExport(json).rows[0].media;
    expect(media.id).toBe(10);
    expect(media.type).toBe("ANIME");
    expect(media.idMal).toBe(5114);
    expect(media.title.romaji).toBe("Frieren");
    expect(media.episodes).toBe(28);
  });

  /** The score's meaning must not depend on the exporting account's format. */
  it("carries a five-star score across as the same raw number", () => {
    const json = buildJsonExport([entry({ score: 4 })], [], "POINT_5", 0);
    expect(parseJsonExport(json).rows[0].scoreRaw).toBe(80);
  });

  it("keeps the private flag, which a MAL round-trip cannot", () => {
    const json = buildJsonExport([entry({ private: true })], [], "POINT_10", 0);
    expect(parseJsonExport(json).rows[0].private).toBe(true);
  });

  /** A JSON file that parses is not evidence of anything. */
  it("takes nothing from a file that is not a Karasu export", () => {
    expect(parseJsonExport('{"source":"somethingelse","anime":[{}]}').rows).toEqual([]);
    expect(parseJsonExport("{}").rows).toEqual([]);
  });

  it("throws only when the text is not JSON at all", () => {
    expect(() => parseJsonExport("not json")).toThrow();
  });

  /** Counted, never silently dropped — the rule `malImport` set. */
  it("counts a row with no media id or an unknown status", () => {
    const out = parseJsonExport(
      JSON.stringify({
        source: "karasu",
        anime: [
          { media: {}, status: "CURRENT" },
          { media: { id: 3 }, status: "WHAT" },
          { media: { id: 4 }, status: "COMPLETED" },
          "not even an object",
        ],
      }),
    );
    expect(out.rows).toHaveLength(1);
    expect(out.skipped).toBe(3);
  });

  /**
   * A partial date is a real answer on AniList; an object with no year is not
   * a date at all and must not arrive as an empty `{}`.
   */
  it("keeps a partial date and rejects a yearless one", () => {
    const out = parseJsonExport(
      JSON.stringify({
        source: "karasu",
        anime: [
          {
            media: { id: 1 },
            status: "COMPLETED",
            startedAt: { year: 2019, month: null, day: null },
            completedAt: { month: 5 },
          },
        ],
      }),
    );
    expect(out.rows[0].startedAt).toEqual({ year: 2019, month: null, day: null });
    expect(out.rows[0].completedAt).toBeNull();
  });

  /** This file may have been edited by hand before it came back. */
  it("clamps numbers rather than writing them to a list", () => {
    const out = parseJsonExport(
      JSON.stringify({
        source: "karasu",
        anime: [
          {
            media: { id: 1 },
            status: "CURRENT",
            scoreRaw: 5000,
            progress: -3,
            repeat: "nonsense",
          },
        ],
      }),
    );
    expect(out.rows[0].scoreRaw).toBe(100);
    expect(out.rows[0].progress).toBe(0);
    expect(out.rows[0].repeat).toBe(0);
  });
});
