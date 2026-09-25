import { describe, expect, it } from "vitest";
import {
  activeFilters,
  CLEAR_FILTERS,
  mergeView,
  parseListView,
  sortPatch,
  toggleFilter,
  writeViewParams,
} from "./listFilters";

const url = (s: string) => new URLSearchParams(s);

describe("parseListView", () => {
  it("reads a bare URL as the default view", () => {
    expect(parseListView(url(""), "ANIME")).toEqual({
      tab: "CURRENT",
      q: "",
      sort: "updated",
      rawDir: "",
      dir: "desc",
      format: "",
      country: "",
      list: "",
      tag: "",
    });
  });

  it("gives each sort key its own default direction and keeps an explicit one", () => {
    expect(parseListView(url("sort=title"), "ANIME").dir).toBe("asc");
    expect(parseListView(url("sort=title&dir=desc"), "ANIME")).toMatchObject({ rawDir: "desc", dir: "desc" });
  });

  it("falls back on values this list cannot have", () => {
    const v = parseListView(url("tab=WATCHING&sort=rank&dir=up&format=NOVEL"), "ANIME");
    expect(v).toMatchObject({ tab: "CURRENT", sort: "updated", rawDir: "", format: "" });
  });

  /** An anime URL carrying a manga origin must not filter the anime list down to nothing. */
  it("ignores the origin on an anime list and reads it on a manga one", () => {
    expect(parseListView(url("country=KR"), "ANIME").country).toBe("");
    expect(parseListView(url("country=KR"), "MANGA").country).toBe("KR");
    expect(parseListView(url("country=XX"), "MANGA").country).toBe("");
  });
});

describe("mergeView", () => {
  const base = parseListView(url("sort=score&dir=asc&format=TV"), "ANIME");

  it("lays a pending filter over the URL's view", () => {
    expect(mergeView(base, { tag: "fav", format: "" })).toMatchObject({ tag: "fav", format: "", sort: "score" });
  });

  it("starts a new sort key from its own default direction", () => {
    expect(mergeView(base, { sort: "title" })).toMatchObject({ sort: "title", rawDir: "", dir: "asc" });
    expect(mergeView(base, sortPatch("title", "desc"))).toMatchObject({ rawDir: "desc", dir: "desc" });
  });

  it("keeps the direction when the patch leaves the sort alone", () => {
    expect(mergeView(base, { tag: "x" })).toMatchObject({ rawDir: "asc", dir: "asc" });
  });
});

describe("writeViewParams", () => {
  it("removes a param set back to its default and keeps the rest", () => {
    const p = writeViewParams(url("tab=PAUSED&format=TV&tag=fav"), { format: "", tag: "old" });
    expect(p.toString()).toBe("tab=PAUSED&tag=old");
  });

  it("drops a stale direction when the key changes without one", () => {
    expect(writeViewParams(url("sort=score&dir=asc"), { sort: "title" }).toString()).toBe("sort=title");
    expect(writeViewParams(url("sort=score&dir=asc"), { sort: "score" }).toString()).toBe("sort=score&dir=asc");
  });

  it("writes the search trimmed, and nothing for blank", () => {
    expect(writeViewParams(url(""), { q: "  frieren " }).get("q")).toBe("frieren");
    expect(writeViewParams(url("q=x"), { q: "   " }).has("q")).toBe(false);
  });

  it("leaves every param a patch does not name", () => {
    expect(writeViewParams(url("q=a&list=Faves&country=JP"), {}).toString()).toBe("q=a&list=Faves&country=JP");
  });
});

describe("sortPatch", () => {
  it("writes no direction for a key's own default", () => {
    expect(sortPatch("updated", "desc")).toEqual({ sort: "updated", dir: "" });
    expect(sortPatch("updated", "asc")).toEqual({ sort: "updated", dir: "asc" });
    expect(sortPatch("title", "asc")).toEqual({ sort: "title", dir: "" });
  });
});

describe("activeFilters", () => {
  it("lists the panel filters in panel order and nothing else", () => {
    expect(activeFilters({ format: "TV", country: "", list: "Faves", tag: "fav" })).toEqual([
      { key: "format", value: "TV" },
      { key: "list", value: "Faves" },
      { key: "tag", value: "fav" },
    ]);
    expect(activeFilters({ format: "", country: "", list: "", tag: "" })).toEqual([]);
  });

  it("is emptied by the reset, which leaves search and sort alone", () => {
    const v = mergeView(parseListView(url("q=a&sort=title&format=TV&tag=x&list=L"), "MANGA"), CLEAR_FILTERS);
    expect(activeFilters(v)).toEqual([]);
    expect(v).toMatchObject({ q: "a", sort: "title" });
  });
});

describe("toggleFilter", () => {
  it("sets a value, and takes it off when pressed again", () => {
    const view = { format: "TV", country: "", list: "", tag: "" };
    expect(toggleFilter(view, "format", "MOVIE")).toEqual({ format: "MOVIE" });
    expect(toggleFilter(view, "format", "TV")).toEqual({ format: "" });
  });
});
