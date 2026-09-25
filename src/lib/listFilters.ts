/** The list header's state as the URL spells it: parsing, the one writer's patch rules, and what the chips show. */

import { STATUS_ORDER, type MediaListStatus, type MediaType } from "@/api/types";
import { MEDIA_FORMATS, ORIGINS } from "@/lib/format";

export type SortKey = "updated" | "title" | "score" | "progress";
export type SortDir = "asc" | "desc";

export const SORT_KEYS: readonly SortKey[] = ["updated", "title", "score", "progress"];

/** What each key means with no direction chosen, so a bare URL keeps its meaning; a flip is relative to this. */
export const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  updated: "desc",
  title: "asc",
  score: "desc",
  progress: "desc",
};

/** The panel filters: what the chips show and the reset clears; search and sort narrow nothing a chip could name. */
export type FilterKey = "format" | "country" | "list" | "tag";
export const FILTER_KEYS: readonly FilterKey[] = ["format", "country", "list", "tag"];

export interface ListView {
  tab: MediaListStatus;
  q: string;
  sort: SortKey;
  /** The direction as written, "" meaning the key's own default; a preset stores this so it keeps following the key. */
  rawDir: "" | SortDir;
  dir: SortDir;
  format: string;
  country: string;
  list: string;
  tag: string;
}

/** A change to the view; `dir: ""` hands the direction back to the sort key. */
export type ViewPatch = Partial<Omit<ListView, "dir" | "rawDir"> & { dir: "" | SortDir }>;

const isDir = (v: string | null): v is SortDir => v === "asc" || v === "desc";

/** Every value falls back to its default when the URL holds one this list cannot have. */
export function parseListView(params: URLSearchParams, type: MediaType): ListView {
  const rawTab = params.get("tab") as MediaListStatus;
  const rawSort = params.get("sort") as SortKey;
  const sort = SORT_KEYS.includes(rawSort) ? rawSort : "updated";
  const rawDirParam = params.get("dir");
  const rawDir = isDir(rawDirParam) ? rawDirParam : "";
  const format = params.get("format") ?? "";
  const country = params.get("country") ?? "";
  return {
    tab: STATUS_ORDER.includes(rawTab) ? rawTab : "CURRENT",
    q: params.get("q") ?? "",
    sort,
    rawDir,
    dir: rawDir || SORT_DEFAULT_DIR[sort],
    format: (MEDIA_FORMATS[type] as readonly string[]).includes(format) ? format : "",
    // Origin is a manga question, so the param is simply ignored on an anime list.
    country: type === "MANGA" && (ORIGINS as readonly string[]).includes(country) ? country : "",
    list: params.get("list") ?? "",
    tag: params.get("tag") ?? "",
  };
}

/** The view with a pending patch laid over it, which is what the list draws while a panel is still open. */
export function mergeView(view: ListView, patch: ViewPatch): ListView {
  const sort = patch.sort ?? view.sort;
  // A new key without a direction starts from that key's default, as the sort panel promises.
  const rawDir = patch.dir ?? (patch.sort !== undefined && patch.sort !== view.sort ? "" : view.rawDir);
  return {
    ...view,
    ...patch,
    sort,
    rawDir,
    dir: rawDir || SORT_DEFAULT_DIR[sort],
  };
}

/** The URL after `patch`: a default value removes its param, so a clean view is a clean URL. */
export function writeViewParams(prev: URLSearchParams, patch: ViewPatch): URLSearchParams {
  const p = new URLSearchParams(prev);
  const write = (key: string, value: string | undefined, def: string) => {
    if (value === undefined) return;
    if (value === def) p.delete(key);
    else p.set(key, value);
  };
  write("tab", patch.tab, "CURRENT");
  write("sort", patch.sort, "updated");
  // A key change without a direction drops the old one, so "score, ascending" does not become "title, ascending".
  if (patch.dir === undefined && patch.sort !== undefined && patch.sort !== (prev.get("sort") ?? "updated")) {
    p.delete("dir");
  }
  write("dir", patch.dir, "");
  write("format", patch.format, "");
  write("country", patch.country, "");
  write("list", patch.list, "");
  write("tag", patch.tag, "");
  write("q", patch.q?.trim(), "");
  return p;
}

/** Choosing a direction writes nothing when it is the key's default, so the URL stays clean. */
export function sortPatch(sort: SortKey, dir: SortDir): ViewPatch {
  return { sort, dir: dir === SORT_DEFAULT_DIR[sort] ? "" : dir };
}

export interface FilterChip {
  key: FilterKey;
  value: string;
}

/** The active panel filters in panel order, one chip each. */
export function activeFilters(view: Pick<ListView, FilterKey>): FilterChip[] {
  return FILTER_KEYS.filter((key) => view[key] !== "").map((key) => ({ key, value: view[key] }));
}

/** Clears every panel filter and nothing else; the search has its own clear button. */
export const CLEAR_FILTERS: ViewPatch = { format: "", country: "", list: "", tag: "" };

/** A pill pressed again takes its filter off, as a radio group with nothing chosen would. */
export function toggleFilter(view: Pick<ListView, FilterKey>, key: FilterKey, value: string): ViewPatch {
  return { [key]: view[key] === value ? "" : value };
}
