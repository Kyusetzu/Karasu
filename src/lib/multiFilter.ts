/**
 * Include / exclude / off, for a filter that takes more than one answer.
 *
 * AniList's own browse page lets you say "Action **and** Drama, but **not**
 * Ecchi" — `Page.media` takes `genre_in`/`genre_not_in` and `tag_in`/`tag_not_in`
 * for exactly that. Karasu offered one genre and one tag, both include-only,
 * which is the difference between a filter and a lens.
 *
 * Pure and here rather than in the component, because two of these functions
 * are load-bearing in ways a component cannot express: `cycle` is the whole
 * interaction, and `encode` is what the query cache is keyed on. An unsorted
 * key would mint a new cache entry every time the user re-picked the same two
 * genres in a different order — the same trap `RecommendedSection` documents
 * for its seed ids.
 */

export type Tri = "off" | "include" | "exclude";

export interface MultiValue {
  include: string[];
  exclude: string[];
}

export const EMPTY: MultiValue = { include: [], exclude: [] };

export function isEmpty(value: MultiValue): boolean {
  return value.include.length === 0 && value.exclude.length === 0;
}

export function triOf(value: MultiValue, option: string): Tri {
  if (value.include.includes(option)) return "include";
  if (value.exclude.includes(option)) return "exclude";
  return "off";
}

/**
 * One click advances a value: off → include → exclude → off.
 *
 * Three states on one control rather than two controls per option. A pair of
 * lists side by side doubles the vertical space for six hundred tags and still
 * has to stop the same tag appearing in both; cycling makes that impossible by
 * construction.
 */
export function cycle(value: MultiValue, option: string): MultiValue {
  const without = {
    include: value.include.filter((o) => o !== option),
    exclude: value.exclude.filter((o) => o !== option),
  };
  switch (triOf(value, option)) {
    case "off":
      return { ...without, include: [...without.include, option] };
    case "include":
      return { ...without, exclude: [...without.exclude, option] };
    case "exclude":
      return without;
  }
}

/**
 * A stable string for the query cache, and only for that.
 *
 * Sorted on both sides so picking Action-then-Drama and Drama-then-Action are
 * one cache entry rather than two. The `-` prefix is unambiguous because
 * AniList's genres and tags never begin with one.
 */
export function encode(value: MultiValue): string {
  return [
    ...[...value.include].sort(),
    ...[...value.exclude].sort().map((o) => `-${o}`),
  ].join(",");
}

/** What the closed control says it is set to. */
export interface Summary {
  /** The first chosen option, prefixed with a minus when it is an exclusion. */
  first: string;
  /** How many more beyond the first, across both sides. */
  extra: number;
}

export function summarize(value: MultiValue): Summary | null {
  const first = value.include[0] ?? (value.exclude[0] ? `−${value.exclude[0]}` : null);
  if (first === null) return null;
  return { first, extra: value.include.length + value.exclude.length - 1 };
}

/**
 * The arguments AniList takes, or `undefined` where it takes none.
 *
 * `undefined` rather than an empty array on purpose: `gql`'s JSON body drops
 * undefined keys, and an absent argument is no filter — where `genre_in: []`
 * is a filter matching nothing.
 */
export function toQueryArgs(value: MultiValue): {
  in?: string[];
  notIn?: string[];
} {
  return {
    in: value.include.length > 0 ? value.include : undefined,
    notIn: value.exclude.length > 0 ? value.exclude : undefined,
  };
}
