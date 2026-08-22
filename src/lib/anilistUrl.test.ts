import { describe, expect, it } from "vitest";
import { internalRoute } from "./anilistUrl";

describe("internalRoute", () => {
  it("maps media URLs, slug or not, either medium", () => {
    expect(internalRoute("https://anilist.co/anime/21/One-Piece/")).toBe("/media/21");
    expect(internalRoute("https://anilist.co/anime/21")).toBe("/media/21");
    expect(internalRoute("https://anilist.co/manga/30013/One-Piece/")).toBe("/media/30013");
    expect(internalRoute("http://www.anilist.co/anime/21")).toBe("/media/21");
  });

  it("lands a thread link on the thread, comment permalinks included", () => {
    expect(internalRoute("https://anilist.co/forum/thread/1")).toBe("/thread/1");
    expect(internalRoute("https://anilist.co/forum/thread/1/comment/3236562")).toBe(
      "/thread/1",
    );
  });

  it("maps people and companies", () => {
    expect(internalRoute("https://anilist.co/user/hori")).toBe("/user/hori");
    expect(internalRoute("https://anilist.co/user/hori/social")).toBe("/user/hori");
    expect(internalRoute("https://anilist.co/character/40")).toBe("/character/40");
    expect(internalRoute("https://anilist.co/staff/95269/")).toBe("/staff/95269");
    expect(internalRoute("https://anilist.co/studio/18")).toBe("/studio/18");
  });

  it("ignores query strings and fragments", () => {
    expect(internalRoute("https://anilist.co/anime/21?ref=share")).toBe("/media/21");
    expect(internalRoute("https://anilist.co/user/hori#about")).toBe("/user/hori");
  });

  /** No route exists for these, so sending them inward would strand the reader. */
  it("refuses what the app cannot draw", () => {
    expect(internalRoute("https://anilist.co/activity/12345")).toBeNull();
    expect(internalRoute("https://anilist.co/forum/overview")).toBeNull();
    expect(internalRoute("https://anilist.co/forum/recent?category=1")).toBeNull();
    expect(internalRoute("https://anilist.co/settings/developer")).toBeNull();
    expect(internalRoute("https://anilist.co/review/1234")).toBeNull();
    expect(internalRoute("https://anilist.co/")).toBeNull();
  });

  it("refuses every other host, lookalikes included", () => {
    expect(internalRoute("https://myanimelist.net/anime/21")).toBeNull();
    expect(internalRoute("https://anilist.co.evil.com/anime/21")).toBeNull();
    expect(internalRoute("https://notanilist.co/anime/21")).toBeNull();
    expect(internalRoute("/media/21")).toBeNull();
  });

  /** The id must be where the id goes — a slug that starts with digits is not one. */
  it("does not read an id out of a malformed path", () => {
    expect(internalRoute("https://anilist.co/anime/")).toBeNull();
    expect(internalRoute("https://anilist.co/anime/abc")).toBeNull();
    expect(internalRoute("https://anilist.co/forum/thread/abc")).toBeNull();
  });
});
