/** Advanced scores read as a name-keyed map and write as a positional array; plain display-scale floats, no `scoreRaw`. */

/** One category, ready to render. */
export interface Category {
  name: string;
  value: number;
}

/** The categories in the account's order with the entry's values; `names` is authoritative, anything unparseable is 0. */
export function orderedCategories(
  names: string[],
  scores: Record<string, unknown> | null | undefined,
): Category[] {
  return names.map((name) => {
    const raw = scores?.[name];
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    return { name, value: Math.max(0, value) };
  });
}

/** The positional array `SaveMediaListEntry` takes, ordered by `names` and never by the map: position is identity. */
export function toAdvancedArray(
  names: string[],
  values: Record<string, number>,
): number[] {
  return names.map((name) => {
    const v = values[name];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  });
}

/** A preview of the overall score AniList will derive, the mean of the scored categories; the server's answer wins. */
export function derivedOverall(values: number[]): number {
  const scored = values.filter((v) => v > 0);
  if (scored.length === 0) return 0;
  return scored.reduce((sum, v) => sum + v, 0) / scored.length;
}

/** Whether anything has been scored — for hiding an all-zero preview. */
export function anyScored(values: number[]): boolean {
  return values.some((v) => v > 0);
}
