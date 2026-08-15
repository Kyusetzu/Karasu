/**
 * Per-category scores, across an asymmetry that will corrupt data if ignored.
 *
 * AniList **reads** them as a name-keyed `Json` map —
 * `{"Story":8,"Characters":9,"Visuals":7}` — and **writes** them as a
 * positional `[Float]`. `SaveMediaListEntry(advancedScores:)` takes a bare
 * array with no names in it at all, so the only ordering the server can mean is
 * the account's own `mediaListOptions.<type>List.advancedScoring`.
 *
 * Build that array from the read map's own key order and it works until the
 * day the user renames or reorders a category on anilist.co — at which point
 * Story's score is written into Characters, silently, on the next save. That is
 * why this is a tested module and not three lines inside a component.
 *
 * There is no `advancedScoresRaw`. These are plain floats in the account's own
 * display scale, so the `scoreRaw` discipline that protects the overall score
 * deliberately does not extend here and must not be applied by reflex.
 */

/** One category, ready to render. */
export interface Category {
  name: string;
  value: number;
}

/**
 * The categories in the account's order, with the entry's values filled in.
 *
 * `names` is authoritative: a category the account no longer has is dropped
 * even if the entry still carries a score for it, and one the entry has never
 * been scored on shows as 0 rather than going missing. Anything unparseable
 * reads as 0 — a category that cannot be shown cannot be edited back either.
 */
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

/**
 * The positional array `SaveMediaListEntry` takes.
 *
 * Ordered by `names`, never by the map. A value missing from `values` is sent
 * as 0, which is AniList's own "not scored" — the array has to be complete
 * because position *is* the identity, and a short array would shift every
 * category after the gap.
 */
export function toAdvancedArray(
  names: string[],
  values: Record<string, number>,
): number[] {
  return names.map((name) => {
    const v = values[name];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  });
}

/**
 * What AniList will make the overall score, for a preview before it answers.
 *
 * The mean of the categories that have been scored — unscored ones are an
 * absence, not a zero, exactly as they are everywhere else in this app.
 * Returns 0 when nothing is scored, which is also "no score".
 *
 * A preview only: the server computes the real one, and `useListMutations`
 * reconciles from the mutation's own result rather than trusting this.
 */
export function derivedOverall(values: number[]): number {
  const scored = values.filter((v) => v > 0);
  if (scored.length === 0) return 0;
  return scored.reduce((sum, v) => sum + v, 0) / scored.length;
}

/** Whether anything has been scored — for hiding an all-zero preview. */
export function anyScored(values: number[]): boolean {
  return values.some((v) => v > 0);
}
