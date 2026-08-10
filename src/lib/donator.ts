/**
 * Whether a user is actually an AniList supporter, and what their badge says.
 *
 * The trap this exists to hold: **`donatorBadge` is the label, not the fact.**
 * AniList returns the default string `"Donator"` for every account whether it
 * has ever paid or not, so a truthiness check on it badges the entire site.
 * Measured across twenty arbitrary users: eighteen had `tier 0` with
 * `badge "Donator"`, one had `tier 3` / `"Angel"`, one `tier 4` /
 * `"kawoshin canon"`.
 *
 * `donatorTier` is the fact — zero means no, anything above means yes — and the
 * badge is a *customisation* a supporter can set, which is why it is only worth
 * reading once the tier says the badge is real. AniList's own profile gates on
 * the tier too, which is how this was caught: a badge appeared in Karasu that
 * anilist.co did not show.
 */
export interface DonatorFields {
  donatorTier?: number | null;
  donatorBadge?: string | null;
}

export function donatorLabel(user: DonatorFields): string | null {
  const tier = user.donatorTier ?? 0;
  if (tier <= 0) return null;
  const badge = user.donatorBadge?.trim();
  // A supporter who never customised it still has the default label, so the
  // fallback is the same word rather than an empty chip.
  return badge || "Donator";
}
