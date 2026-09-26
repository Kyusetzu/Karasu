/** The one status-to-colour vocabulary for the whole app; the defaults are not the accent so they stay distinguishable. */

import type { MediaListStatus } from "@/api/types";
import { contrastRatio } from "@/lib/contrast";

export type StatusPalette = Record<MediaListStatus, string>;

export const DEFAULT_STATUS_COLORS: StatusPalette = {
  CURRENT: "#2f9e47",
  REPEATING: "#1a7f37",
  COMPLETED: "#4b8dd6",
  PAUSED: "#b87a14",
  DROPPED: "#d1495b",
  PLANNING: "#6b7280",
};

/** Defaults a release shipped and replaced; a palette saved while they were current carries them as if chosen. */
const RETIRED_DEFAULTS: Partial<Record<MediaListStatus, string[]>> = {
  CURRENT: ["#3fb950"],
  PAUSED: ["#d9a13b"],
};

/** Stored beside the colours, so a retired default picked after the move reads as the choice it is. */
export const STATUS_PALETTE_VERSION = 2;

/** What a status colour must reach against the surfaces it sits on, the non-text contrast every mark needs. */
export const STATUS_CONTRAST_MIN = 3;

/** The weakest contrast a colour makes against the given grounds, or null when there is no ground to measure. */
export function weakestContrast(hex: string, grounds: readonly string[]): number | null {
  // Three digits too, because the CSS minifier shortens a ground such as white before the page reads it back.
  const valid = grounds.filter((g) => GROUND.test(g));
  if (!isStatusHex(hex) || valid.length === 0) return null;
  return Math.min(...valid.map((g) => contrastRatio(hex, g)));
}

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
const GROUND = /^#(?:[0-9a-f]{3}){1,2}$/i;

export const isStatusHex = (v: unknown): v is string =>
  typeof v === "string" && HEX.test(v);

/** A stored palette with each unusable entry, and a retired default in an unversioned one, set to today's default. */
export function normalizeStatusColors(stored: unknown): StatusPalette {
  const src = (stored ?? {}) as Partial<Record<string, unknown>>;
  const legacy = src.v !== STATUS_PALETTE_VERSION;
  const out = {} as StatusPalette;
  for (const key of STATUS_COLOR_ORDER) {
    const v = src[key];
    const retired = legacy && isStatusHex(v) && (RETIRED_DEFAULTS[key] ?? []).includes(v.toLowerCase());
    out[key] = isStatusHex(v) && !retired ? v : DEFAULT_STATUS_COLORS[key];
  }
  return out;
}

/** The palette as stored, versioned so the next read keeps every colour in it. */
export const serializeStatusColors = (p: StatusPalette): string => JSON.stringify({ ...p, v: STATUS_PALETTE_VERSION });

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
