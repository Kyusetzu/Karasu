/** Include / exclude / off for the genre and tag filters; `cycle` is the interaction and `encode` is the query cache key. */

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

/** One click advances a value off → include → exclude → off, so an option can never sit on both sides. */
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

/** A stable query-cache key: keep both sides sorted, or re-picking the same options in another order mints a new entry. */
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

/** The arguments AniList takes, `undefined` rather than `[]` where none apply because an empty `genre_in` matches nothing. */
export function toQueryArgs(value: MultiValue): {
  in?: string[];
  notIn?: string[];
} {
  return {
    in: value.include.length > 0 ? value.include : undefined,
    notIn: value.exclude.length > 0 ? value.exclude : undefined,
  };
}
