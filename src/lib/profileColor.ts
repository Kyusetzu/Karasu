/** AniList's profile accent: seven names, or a hex value for supporters; `UpdateUser` takes the name, never a swatch hex. */

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

/** A value fit to send, cased as AniList returns it so a round trip does not read as a change, or null. */
export function normalizeProfileColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if ((PROFILE_COLORS as readonly string[]).includes(lower)) return lower;
  // Three-digit hex is not accepted: expanding it here would send a value the user did not type.
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
