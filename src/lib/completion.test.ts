import { describe, expect, it } from "vitest";
import { entry, media } from "@/test/fixtures";
import {
  chooseStatus,
  completionFill,
  openingFields,
  completionGroups,
  splitBulkPatch,
  withCompletion,
} from "./completion";

const manga = (over: Parameters<typeof media>[0] = {}) =>
  media({ type: "MANGA", episodes: null, chapters: 120, volumes: 12, ...over });

describe("completionFill", () => {
  it("takes the episode count for anime and never a volume count", () => {
    expect(completionFill(media({ volumes: 3 }))).toEqual({ progress: 26 });
  });

  it("takes chapters and volumes for manga", () => {
    expect(completionFill(manga())).toEqual({ progress: 120, progressVolumes: 12 });
  });

  /** The user's own number is the answer where AniList has none. */
  it("fills nothing where the totals are unknown", () => {
    expect(completionFill(media({ episodes: null }))).toEqual({});
    expect(completionFill(manga({ chapters: null, volumes: null }))).toEqual({});
  });

  it("fills chapters alone when only the volume count is unknown", () => {
    expect(completionFill(manga({ volumes: null }))).toEqual({ progress: 120 });
  });

  it("lets the caller's media type decide when the blob carries none", () => {
    expect(completionFill(manga({ type: undefined }), "MANGA")).toEqual({
      progress: 120,
      progressVolumes: 12,
    });
    expect(completionFill(manga({ type: undefined }))).toEqual({ progress: 120 });
  });
});

describe("withCompletion", () => {
  it("fills the totals into a bare status change", () => {
    expect(withCompletion({ mediaId: 1, status: "COMPLETED" }, media())).toEqual({
      mediaId: 1,
      status: "COMPLETED",
      progress: 26,
    });
  });

  it("keeps a number the user sent", () => {
    expect(
      withCompletion({ mediaId: 1, status: "COMPLETED", progress: 20 }, manga()),
    ).toEqual({ mediaId: 1, status: "COMPLETED", progress: 20, progressVolumes: 12 });
  });

  it("leaves every other status alone", () => {
    const input = { mediaId: 1, status: "PAUSED" as const };
    expect(withCompletion(input, media())).toBe(input);
    const noStatus = { mediaId: 1, progress: 3 };
    expect(withCompletion(noStatus, media())).toBe(noStatus);
  });

  /** A manga whose chapter count grew after it was finished keeps the number it was finished at. */
  it("rewrites nothing when the entry was completed already", () => {
    const input = { mediaId: 1, status: "COMPLETED" as const };
    expect(withCompletion(input, manga(), "MANGA", "COMPLETED")).toBe(input);
    expect(withCompletion(input, manga(), "MANGA", "CURRENT")).toEqual({
      ...input,
      progress: 120,
      progressVolumes: 12,
    });
    expect(withCompletion(input, manga(), "MANGA", null)).toHaveProperty("progress", 120);
  });

  it("changes nothing without the media to read the totals from", () => {
    const input = { mediaId: 1, status: "COMPLETED" as const };
    expect(withCompletion(input, undefined)).toBe(input);
  });
});

describe("completionGroups", () => {
  it("puts entries with the same totals into one request", () => {
    const a = entry({ id: 1, mediaId: 1, media: media({ id: 1, episodes: 12 }) });
    const b = entry({ id: 2, mediaId: 2, media: media({ id: 2, episodes: 24 }) });
    const c = entry({ id: 3, mediaId: 3, media: media({ id: 3, episodes: 12 }) });
    const d = entry({ id: 4, mediaId: 4, media: media({ id: 4, episodes: null }) });
    const groups = completionGroups([a, b, c, d]);
    expect(groups.map((g) => [g.fill, g.entries.map((e) => e.id)])).toEqual([
      [{ progress: 12 }, [1, 3]],
      [{ progress: 24 }, [2]],
      [{}, [4]],
    ]);
  });

  it("leaves entries that are completed already in the group that fills nothing", () => {
    const done = entry({ id: 5, mediaId: 5, status: "COMPLETED", progress: 10, media: media({ id: 5, episodes: 12 }) });
    const open = entry({ id: 6, mediaId: 6, media: media({ id: 6, episodes: 12 }) });
    expect(completionGroups([done, open]).map((g) => [g.fill, g.entries.map((e) => e.id)])).toEqual([
      [{}, [5]],
      [{ progress: 12 }, [6]],
    ]);
  });

  it("splits manga on volumes as well as chapters", () => {
    const a = entry({ id: 1, mediaId: 1, media: manga({ id: 1, volumes: 12 }) });
    const b = entry({ id: 2, mediaId: 2, media: manga({ id: 2, volumes: 13 }) });
    expect(completionGroups([a, b], "MANGA")).toHaveLength(2);
  });
});

describe("splitBulkPatch", () => {
  const a = entry({ id: 1, mediaId: 1, media: media({ id: 1, episodes: 12 }) });
  const b = entry({ id: 2, mediaId: 2, media: media({ id: 2, episodes: 24 }) });

  it("keeps any other patch as the single request it always was", () => {
    expect(splitBulkPatch([a, b], { status: "PAUSED" })).toEqual([
      { entries: [a, b], patch: { status: "PAUSED" } },
    ]);
  });

  it("keeps a completion that already names its progress whole", () => {
    expect(splitBulkPatch([a, b], { status: "COMPLETED", progress: 3 })).toHaveLength(1);
  });

  it("splits a bare completion into one request per total", () => {
    expect(splitBulkPatch([a, b], { status: "COMPLETED" })).toEqual([
      { entries: [a], patch: { status: "COMPLETED", progress: 12 } },
      { entries: [b], patch: { status: "COMPLETED", progress: 24 } },
    ]);
  });

  it("sends nothing for an empty selection", () => {
    expect(splitBulkPatch([], { status: "COMPLETED" })).toEqual([]);
    expect(splitBulkPatch([], { status: "PAUSED" })).toEqual([]);
  });
});

describe("chooseStatus", () => {
  const start = { status: "CURRENT" as const, progress: 5, volumes: 1 };

  it("shows the totals once COMPLETED is picked", () => {
    const { fields, memo } = chooseStatus(start, null, "COMPLETED", manga());
    expect(fields).toEqual({ status: "COMPLETED", progress: 120, volumes: 12 });
    expect(memo).toEqual({
      before: { progress: 5, volumes: 1 },
      filled: { progress: 120, volumes: 12 },
    });
  });

  it("gives the user's numbers back when COMPLETED is left untouched", () => {
    const done = chooseStatus(start, null, "COMPLETED", manga());
    const back = chooseStatus(done.fields, done.memo, "PAUSED", manga());
    expect(back.fields).toEqual({ status: "PAUSED", progress: 5, volumes: 1 });
    expect(back.memo).toBeNull();
  });

  it("keeps a number typed after the fill", () => {
    const done = chooseStatus(start, null, "COMPLETED", manga());
    const typed = { ...done.fields, progress: 100 };
    expect(chooseStatus(typed, done.memo, "CURRENT", manga()).fields).toEqual({
      status: "CURRENT",
      progress: 100,
      volumes: 12,
    });
  });

  it("keeps the user's number where the total is unknown", () => {
    const { fields, memo } = chooseStatus(start, null, "COMPLETED", media({ episodes: null }));
    expect(fields).toEqual({ status: "COMPLETED", progress: 5, volumes: 1 });
    expect(memo).toBeNull();
  });

  it("only moves the status between two other pills", () => {
    expect(chooseStatus(start, null, "DROPPED", media()).fields).toEqual({ ...start, status: "DROPPED" });
  });
});

describe("openingFields", () => {
  it("opens an existing entry on its own numbers, finished or not", () => {
    const existing = { status: "COMPLETED" as const, progress: 10, volumes: 0 };
    expect(openingFields(existing, "PLANNING", media())).toEqual({ fields: existing, memo: null });
  });

  /** The default-add setting can be Completed, and a first add must not arrive at episode zero. */
  it("starts a first add on the totals when the default status is Completed", () => {
    expect(openingFields(null, "COMPLETED", media()).fields).toEqual({
      status: "COMPLETED",
      progress: 26,
      volumes: 0,
    });
    expect(openingFields(null, "PLANNING", media()).fields).toEqual({
      status: "PLANNING",
      progress: 0,
      volumes: 0,
    });
  });
});
