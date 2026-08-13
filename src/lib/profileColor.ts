/**
 * AniList's profile accent: seven names, or a hex value for supporters.
 *
 * Sampled across fifty real accounts, every value was one of seven names —
 * `pink` (9), `orange` (8), `green` (8), `purple` (7), `red` (6), `gray` (5),
 * `blue` (5) — plus two hex values, `#FF0000` and `#E6D0FF`. Custom hex is a
 * supporter feature on AniList, so a non-supporter sending one may find it
 * ignored server-side; that is AniList's rule to enforce, not this function's.
 *
 * The swatch hexes below are AniList's own palette values, kept here only so the
 * picker can show what each name looks like. They are never sent — the *name*
 * is what `UpdateUser` takes.
 */

export const PROFILE_COLORS = [
  "blue",
  "purple",
  "pink",
  "orange",
  "red",
  "green",
  "gray",
] as const;

export type ProfileColorName = (typeof PROFILE_COLORS)[number];

/** AniList's own palette, for the swatches. Display only. */
export const PROFILE_COLOR_HEX: Record<ProfileColorName, string> = {
  blue: "#3db4f2",
  purple: "#c063ff",
  pink: "#fc9dd6",
  orange: "#ef881a",
  red: "#e13333",
  green: "#4cca51",
  gray: "#677b94",
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A value fit to send, or null if it is neither a known name nor a hex colour.
 *
 * Names are lowercased and hex is uppercased, matching how AniList returns each
 * — so a round trip does not look like a change and the save button does not
 * light up for nothing.
 */
export function normalizeProfileColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if ((PROFILE_COLORS as readonly string[]).includes(lower)) return lower;
  // Three-digit hex is not accepted: AniList returns six and expanding it here
  // would send a value the user did not type.
  if (HEX.test(v)) return v.toUpperCase();
  return null;
}

/** Whether a stored value is one of the seven names rather than a hex colour. */
export function isNamedColor(value: string | null | undefined): value is ProfileColorName {
  return (
    !!value && (PROFILE_COLORS as readonly string[]).includes(value.trim().toLowerCase())
  );
}

/** Something to paint a swatch with, for a name or a hex value alike. */
export function profileColorSwatch(value: string | null | undefined): string | null {
  const normal = normalizeProfileColor(value);
  if (!normal) return null;
  return isNamedColor(normal) ? PROFILE_COLOR_HEX[normal] : normal;
}
