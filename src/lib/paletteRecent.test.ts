import { describe, expect, it } from "vitest";
import { RECENT_MAX, isRecordable, parseRecent, pushRecent } from "./paletteRecent";

describe("paletteRecent", () => {
  it("remembers screens and commands", () => {
    expect(isRecordable("/")).toBe(true);
    expect(isRecordable("/calendar")).toBe(true);
    expect(isRecordable("command:sync")).toBe(true);
  });

  it("never remembers a title, however it is spelled", () => {
    expect(isRecordable("m-21")).toBe(false);
    expect(isRecordable("/media/21")).toBe(false);
    expect(isRecordable("/user/Kyusetzu")).toBe(false);
    expect(isRecordable("command:open/21")).toBe(false);
    expect(pushRecent(["/stats"], "m-21")).toEqual(["/stats"]);
  });

  it("moves a repeat to the front instead of listing it twice", () => {
    expect(pushRecent(["/stats", "/calendar", "command:sync"], "/calendar")).toEqual([
      "/calendar",
      "/stats",
      "command:sync",
    ]);
  });

  it("keeps only the newest few", () => {
    let list: string[] = [];
    for (const id of ["/", "/list", "/manga", "/search", "/seasonal", "/calendar", "/stats"]) list = pushRecent(list, id);
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0]).toBe("/stats");
    expect(list).not.toContain("/");
  });

  it("reads back junk as nothing and a tampered list as its recordable part", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("not json")).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent('["/stats", 3, "m-21", "/stats", "command:sync"]')).toEqual(["/stats", "command:sync"]);
  });

  it("caps a stored list longer than the limit", () => {
    const long = JSON.stringify(["/", "/list", "/manga", "/search", "/seasonal", "/calendar"]);
    expect(parseRecent(long)).toHaveLength(RECENT_MAX);
  });
});
