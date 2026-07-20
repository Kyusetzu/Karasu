import type { TFunction } from "i18next";

/** AniList media-format enum values we have explicit labels for. */
const KNOWN = new Set([
  "TV",
  "TV_SHORT",
  "MOVIE",
  "SPECIAL",
  "OVA",
  "ONA",
  "MUSIC",
  "MANGA",
  "NOVEL",
  "ONE_SHOT",
]);

/**
 * Human-readable label for an AniList media format (e.g. `TV_SHORT` →
 * "TV Short"). Unknown/new enum values are title-cased as a safe fallback so a
 * raw `SOME_NEW_FORMAT` never leaks into the UI.
 */
export function formatLabel(
  format: string | null | undefined,
  t: TFunction,
): string {
  if (!format) return "";
  if (KNOWN.has(format)) return t(`format.${format}`);
  return format
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
