/**
 * One colour per list status, for the whole app.
 *
 * Karasu had exactly one status→colour map before this, page-local to
 * `Franchise`, where Watching rode the accent and Completed was a fixed green.
 * A cover ring needed the same idea, and two maps would have meant a colour
 * meaning one thing on a card and another in the graph — so this is the single
 * vocabulary and Franchise reads it too.
 *
 * The defaults are deliberately *not* the accent. A user picks the accent for
 * how it looks; these have to be told apart from each other at ring width, and
 * one of them changing every time the accent does would break that. Watching is
 * green because it is the healthy state, Dropped red, Paused amber, Planning
 * grey because it is the absence of activity, and Rewatching a deeper green so
 * it reads as a variant of Watching rather than a seventh unrelated hue.
 */

import type { MediaListStatus } from "@/api/types";

export type StatusPalette = Record<MediaListStatus, string>;

export const DEFAULT_STATUS_COLORS: StatusPalette = {
  CURRENT: "#3fb950",
  REPEATING: "#1a7f37",
  COMPLETED: "#4b8dd6",
  PAUSED: "#d9a13b",
  DROPPED: "#d1495b",
  PLANNING: "#6b7280",
};

/** Not on any list. Never user-editable: it is the absence of a status. */
export const NO_STATUS_COLOR = "var(--color-graph-none)";

/** The order the settings swatches and the legend use. */
export const STATUS_COLOR_ORDER: MediaListStatus[] = [
  "CURRENT",
  "REPEATING",
  "COMPLETED",
  "PAUSED",
  "DROPPED",
  "PLANNING",
];

const HEX = /^#[0-9a-f]{6}$/i;

export const isStatusHex = (v: unknown): v is string =>
  typeof v === "string" && HEX.test(v);

/**
 * A stored palette, with anything unusable replaced by its default.
 *
 * Per key rather than all-or-nothing: a single corrupted entry should cost that
 * one colour, not the five beside it that are still fine. Extra keys are
 * dropped — a status AniList retires must not linger in a `Record` the rest of
 * the app indexes by a live union.
 */
export function normalizeStatusColors(stored: unknown): StatusPalette {
  const src = (stored ?? {}) as Partial<Record<string, unknown>>;
  const out = {} as StatusPalette;
  for (const key of STATUS_COLOR_ORDER) {
    const v = src[key];
    out[key] = isStatusHex(v) ? v : DEFAULT_STATUS_COLORS[key];
  }
  return out;
}

/** Whether a palette is the shipped one — the settings Reset button's gate. */
export function isDefaultPalette(p: StatusPalette): boolean {
  return STATUS_COLOR_ORDER.every(
    (k) => p[k].toLowerCase() === DEFAULT_STATUS_COLORS[k].toLowerCase(),
  );
}

/** The CSS custom property a status writes to. Kebab, like every other token. */
export const statusVar = (status: MediaListStatus): string =>
  `--color-status-${status.toLowerCase()}`;

/**
 * What to paint for a status, as a `var()` so a live palette change repaints
 * without re-rendering anything.
 *
 * `null` is "not on your list", which is a real answer on a search result and
 * must stay distinguishable from Planning — see `Franchise`, where the two are
 * three RGB points apart by default and the *line style* carries the
 * difference. A user picking two similar hues cannot break that.
 */
export const statusColorVar = (status: MediaListStatus | null): string =>
  status ? `var(${statusVar(status)})` : NO_STATUS_COLOR;
