/** The one status-to-colour vocabulary for the whole app; the defaults are not the accent so they stay distinguishable. */

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

/** A stored palette with each unusable entry replaced by its own default and unknown keys dropped. */
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

/** What to paint for a status as a `var()`, so a palette change repaints live; `null` is "not on your list", not Planning. */
export const statusColorVar = (status: MediaListStatus | null): string =>
  status ? `var(${statusVar(status)})` : NO_STATUS_COLOR;
