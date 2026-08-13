/**
 * AniList's five score formats, as one vocabulary.
 *
 * The account's `scoreFormat` decides two things at once: how `score: Float`
 * is *interpreted* when written, and what `score(format:)` returns when read.
 * Karasu historically pinned ten-point on the read side while writing the
 * bare float — which corrupted scores on any non-ten-point account (an ★8
 * sent to a 100-point account stores 8/100). The cure has two halves:
 *
 * - **Writes go through `scoreRaw`** (0–100 int, format-independent) built by
 *   `toRaw` — correct whatever the account is set to, and safe to replay from
 *   the offline queue even if the format changed in between.
 * - **Reads and controls follow the format**, using `scoreScale` for ranges
 *   and `formatScore` for rendering.
 *
 * POINT_3 is AniList's smiley scale; its raw mapping (35/60/85) is the one
 * the site itself uses.
 */

export type ScoreFormat =
  | "POINT_100"
  | "POINT_10_DECIMAL"
  | "POINT_10"
  | "POINT_5"
  | "POINT_3";

export const SCORE_FORMATS: ScoreFormat[] = [
  "POINT_100",
  "POINT_10_DECIMAL",
  "POINT_10",
  "POINT_5",
  "POINT_3",
];

export const DEFAULT_SCORE_FORMAT: ScoreFormat = "POINT_10";

/** Whatever the server sent, as a format — unknown strings fall back to ten. */
export function asScoreFormat(value: string | null | undefined): ScoreFormat {
  return SCORE_FORMATS.includes(value as ScoreFormat)
    ? (value as ScoreFormat)
    : DEFAULT_SCORE_FORMAT;
}

export interface ScoreScale {
  max: number;
  step: number;
  decimals: number;
}

export function scoreScale(f: ScoreFormat): ScoreScale {
  switch (f) {
    case "POINT_100":
      return { max: 100, step: 1, decimals: 0 };
    case "POINT_10_DECIMAL":
      return { max: 10, step: 0.1, decimals: 1 };
    case "POINT_10":
      return { max: 10, step: 1, decimals: 0 };
    case "POINT_5":
      return { max: 5, step: 1, decimals: 0 };
    case "POINT_3":
      return { max: 3, step: 1, decimals: 0 };
  }
}

/** The smiley scale's raw values, as anilist.co itself writes them. */
const POINT_3_RAW = [0, 35, 60, 85] as const;

/**
 * A display-format value as the 0–100 integer `scoreRaw` takes.
 * Zero stays zero — it means "unscored", not "scored the minimum".
 */
export function toRaw(f: ScoreFormat, value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const { max } = scoreScale(f);
  const clamped = Math.min(max, value);
  if (f === "POINT_3") return POINT_3_RAW[Math.round(clamped)];
  return Math.round((clamped / max) * 100);
}

/** The inverse, for anything holding a raw hundred-point number. */
export function fromRaw(f: ScoreFormat, raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const { max, decimals } = scoreScale(f);
  const clamped = Math.min(100, raw);
  if (f === "POINT_3") return clamped <= 35 ? 1 : clamped <= 60 ? 2 : 3;
  const value = (clamped / 100) * max;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** The smiley glyphs, index = score. Emoji, so no i18n key is needed. */
const SMILEYS = ["", "☹️", "😐", "🙂"] as const;

/**
 * A score as the user's format displays it. Zero renders as an en dash —
 * every call site treats zero as "unscored", and printing "0" would claim a
 * score nobody gave.
 */
export function formatScore(f: ScoreFormat, value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "–";
  if (f === "POINT_3") return SMILEYS[Math.min(3, Math.round(value))] || "–";
  const { max, decimals } = scoreScale(f);
  return Math.min(max, value).toFixed(decimals);
}

/**
 * An *aggregate* (mean, delta) on the display scale. Always one decimal —
 * a mean of integers is not an integer — and numeric even for the smiley
 * scale, where "😐, roughly" has no glyph and a number is at least honest.
 */
export function formatMeanScore(f: ScoreFormat, value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "–";
  return Math.min(scoreScale(f).max, value).toFixed(1);
}

/**
 * The selectable values for a discrete format, or `null` for the two
 * continuous ones (POINT_100 and POINT_10_DECIMAL take a number input — a
 * select of a hundred options is not a control).
 */
export function scoreOptions(f: ScoreFormat): number[] | null {
  switch (f) {
    case "POINT_10":
      return Array.from({ length: 10 }, (_, i) => i + 1);
    case "POINT_5":
      return [1, 2, 3, 4, 5];
    case "POINT_3":
      return [1, 2, 3];
    default:
      return null;
  }
}
