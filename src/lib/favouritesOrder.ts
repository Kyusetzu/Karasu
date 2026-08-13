import type { FavouriteKind } from "@/api/social";

/**
 * The reorder modal's pure half.
 *
 * `UpdateFavouriteOrder` replaces a kind's whole set, so the one invariant
 * that matters is: the variables always carry **every** id, in the new order,
 * with a 1-based position for each. Dropping an id from the arrays is
 * indistinguishable from unfavouriting it, which is why `toOrderVars` is the
 * only place the variables are built and why its tests count the set.
 */

/** The `(idsArg, orderArg)` pair per kind, matching the mutation's argument names. */
export const FAV_ORDER_ARGS: Record<FavouriteKind, [string, string]> = {
  anime: ["animeIds", "animeOrder"],
  manga: ["mangaIds", "mangaOrder"],
  character: ["characterIds", "characterOrder"],
  staff: ["staffIds", "staffOrder"],
  studio: ["studioIds", "studioOrder"],
};

/**
 * The list with one item moved, or the same array when the move is a no-op —
 * out-of-range targets clamp rather than throw, so holding an arrow at the top
 * of the list is harmless.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const clamped = Math.max(0, Math.min(list.length - 1, to));
  if (clamped === from) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item);
  return next;
}

/** Variables for one kind's whole-array save: every id, positions 1-based. */
export function toOrderVars(
  kind: FavouriteKind,
  ids: number[],
): Record<string, number[]> {
  const [idsArg, orderArg] = FAV_ORDER_ARGS[kind];
  return {
    [idsArg]: ids,
    [orderArg]: ids.map((_, i) => i + 1),
  };
}
