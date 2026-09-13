import type { FavouriteKind } from "@/api/social";

/** The reorder modal's pure half; the variables must carry every id, since a dropped id reads as an unfavourite. */

/** The `(idsArg, orderArg)` pair per kind, matching the mutation's argument names. */
export const FAV_ORDER_ARGS: Record<FavouriteKind, [string, string]> = {
  anime: ["animeIds", "animeOrder"],
  manga: ["mangaIds", "mangaOrder"],
  character: ["characterIds", "characterOrder"],
  staff: ["staffIds", "staffOrder"],
  studio: ["studioIds", "studioOrder"],
};

/** The list with one item moved, or the same array for a no-op; out-of-range targets clamp rather than throw. */
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
