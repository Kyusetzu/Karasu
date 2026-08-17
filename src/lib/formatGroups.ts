/**
 * Splitting a season into format sections, and moving around one with arrows.
 *
 * A season is fifty titles in one wall, and a TV series, a five-minute short
 * and a music video are not comparable things to scan past each other. Grouping
 * them is cheap here because Seasonal is unvirtualized — fifty items, a plain
 * CSS grid — so a section is just another grid, and none of `VirtualGrid`'s
 * row-chunking applies.
 *
 * What is *not* free is the keyboard. `nextFocus` treats the results as one
 * uniform rectangle, so with ragged section ends "down" from the last row of
 * one group lands at the wrong offset in the next. `nextFocusGrouped` below is
 * that arithmetic done properly.
 */

import type { Move } from "./roving";

/** The reading order asked for, most-substantial first. */
export const FORMAT_ORDER = [
  "TV",
  "MOVIE",
  "TV_SHORT",
  "SPECIAL",
  "OVA",
  "ONA",
  "MUSIC",
] as const;

export interface FormatGroup<T> {
  /** An AniList format, or `null` for the trailing catch-all. */
  format: string | null;
  items: T[];
  /** Where this group's first item sits in the flattened order. */
  offset: number;
}

/**
 * Groups by `format`, in `FORMAT_ORDER`, with everything else last.
 *
 * `Media.format` is typed `string | null`, not a union — so a value AniList
 * adds later must land somewhere rather than vanishing. It joins the trailing
 * group, which is why that group is keyed `null` and labelled generically: an
 * unknown format is not "no format", but on screen they are the same shrug.
 *
 * Empty groups are dropped: a heading over nothing is worse than no heading.
 */
export function groupByFormat<T extends { format?: string | null }>(
  items: readonly T[],
): FormatGroup<T>[] {
  const known = new Map<string, T[]>();
  const rest: T[] = [];
  for (const item of items) {
    const f = item.format ?? "";
    if ((FORMAT_ORDER as readonly string[]).includes(f)) {
      const bucket = known.get(f);
      if (bucket) bucket.push(item);
      else known.set(f, [item]);
    } else {
      rest.push(item);
    }
  }

  const groups: FormatGroup<T>[] = [];
  let offset = 0;
  for (const format of FORMAT_ORDER) {
    const items = known.get(format);
    if (!items?.length) continue;
    groups.push({ format, items, offset });
    offset += items.length;
  }
  if (rest.length) groups.push({ format: null, items: rest, offset });
  return groups;
}

/** The grouped order as one array — what the roving index counts over. */
export function flattenGroups<T>(groups: readonly FormatGroup<T>[]): T[] {
  return groups.flatMap((g) => g.items);
}

/**
 * Arrow movement over sections of unequal length.
 *
 * Left and right run through the whole list, so the end of one section leads
 * into the next — which is what a reader expects from a flat sequence.
 *
 * Up and down move by a row *within* the section the focus is in, and step into
 * the neighbouring section only when there is no row to move to. Crossing keeps
 * the column where it can: dropping out of column 3 should arrive at column 3,
 * or at the nearest thing the next section's first row has.
 *
 * Falling out of the bottom of the last section, or the top of the first, is a
 * no-op rather than a wrap — the same rule `nextFocus` documents.
 */
export function nextFocusGrouped(
  current: number | null,
  move: Move,
  columns: number,
  sizes: readonly number[],
): number | null {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  if (current === null) return 0;
  const cols = Math.max(1, Math.floor(columns));
  const at = Math.min(Math.max(current, 0), total - 1);

  if (move === "left" || move === "right") {
    return Math.min(Math.max(at + (move === "right" ? 1 : -1), 0), total - 1);
  }

  // Which section holds it, and where inside.
  let s = 0;
  let start = 0;
  while (s < sizes.length - 1 && start + sizes[s] <= at) {
    start += sizes[s];
    s += 1;
  }
  const local = at - start;
  const column = local % cols;

  if (move === "down") {
    const next = local + cols;
    if (next < sizes[s]) return start + next;
    // Past the end of this section: the *last* row is often ragged, so land on
    // its final item before leaving — otherwise a press can skip a whole row.
    const lastRowStart = Math.floor((sizes[s] - 1) / cols) * cols;
    if (local < lastRowStart) return start + sizes[s] - 1;
    if (s + 1 >= sizes.length) return at;
    const nextStart = start + sizes[s];
    return nextStart + Math.min(column, sizes[s + 1] - 1);
  }

  const prev = local - cols;
  if (prev >= 0) return start + prev;
  if (s === 0) return at;
  const prevStart = start - sizes[s - 1];
  // Into the previous section's *last* row, keeping the column where it exists.
  const prevLastRowStart = Math.floor((sizes[s - 1] - 1) / cols) * cols;
  return prevStart + Math.min(prevLastRowStart + column, sizes[s - 1] - 1);
}
