import { describe, expect, it } from "vitest";
import { entryFromEcho } from "./listEcho";

describe("entryFromEcho", () => {
  it("takes AniList's echo, which carries the entry's fields", () => {
    const echo = { id: 7, mediaId: 42, status: "CURRENT", progress: 3, score: 8, repeat: 0, notes: null, updatedAt: 1 };
    expect(entryFromEcho(echo)).toEqual({ id: 7, status: "CURRENT", progress: 3, score: 8, repeat: 0, notes: null });
  });

  /** The local save answers with ids and a timestamp; patched in as the entry, the badge read "status.ANIME.undefined". */
  it("refuses the local echo, which names no status", () => {
    expect(entryFromEcho({ id: 42, mediaId: 42, updatedAt: 1 })).toBeNull();
  });

  it("refuses nothing at all", () => {
    expect(entryFromEcho(null)).toBeNull();
    expect(entryFromEcho(undefined)).toBeNull();
    expect(entryFromEcho("CURRENT")).toBeNull();
  });
});
