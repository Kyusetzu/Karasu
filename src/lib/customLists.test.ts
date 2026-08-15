import { describe, expect, it } from "vitest";
import { customListNames } from "./customLists";
import type { MediaListGroup } from "@/api/types";

const group = (
  name: string,
  isCustomList: boolean,
  entries: (Record<string, boolean> | null)[],
): MediaListGroup =>
  ({
    name,
    status: "CURRENT",
    isCustomList,
    entries: entries.map((customLists, i) => ({ id: i, mediaId: i, customLists })),
  }) as unknown as MediaListGroup;

describe("customListNames", () => {
  /**
   * The bug this exists for. AniList's group `name` is display-cased; the
   * membership map and `SaveMediaListEntry(customLists:)` use the raw name.
   * Reading the first and writing the second is what made the whole feature
   * silently do nothing for anyone who did not capitalise their list.
   */
  it("takes the raw names from the entries, not the display names from the groups", () => {
    const groups = [
      group("Watching", false, [{ backlog: false, unaired: true }]),
      group("Backlog", true, [{ backlog: true, unaired: false }]),
    ];
    expect(customListNames(groups)).toEqual(["backlog", "unaired"]);
  });

  /** Every entry carries the whole declared set, members and non-members. */
  it("finds a list nobody is in yet", () => {
    const groups = [group("Watching", false, [{ someday: false }])];
    expect(customListNames(groups)).toEqual(["someday"]);
  });

  it("unions across groups and entries without repeating", () => {
    const groups = [
      group("Watching", false, [{ a: true }, { a: false, b: true }]),
      group("Completed", false, [{ a: false, b: false, c: true }]),
    ];
    expect(customListNames(groups)).toEqual(["a", "b", "c"]);
  });

  it("survives an entry with no map at all", () => {
    const groups = [group("Watching", false, [null, { a: true }])];
    expect(customListNames(groups)).toEqual(["a"]);
  });

  /** No entries means no lists to offer, which is the honest answer. */
  it("reports nothing for an empty list", () => {
    expect(customListNames([])).toEqual([]);
    expect(customListNames([group("Watching", false, [])])).toEqual([]);
  });
});
