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

// --- What the tier lets the account do ---------------------------------------
//
// Pinning an activity to the top of a profile is a tier-2 feature: the API
// answers anyone below it with HTTP 403 and "Sorry, you must be at least a
// tier 2 donator to pin activities". The client used to read that as an
// expired session. Now the viewer carries its tier (`VIEWER_QUERY`) and the
// control is not offered where it can only fail — with one exception below.

/** The tier AniList asks for before it lets an activity be pinned. */
export const PIN_TIER = 2;

export type PinAbility = "yes" | "no" | "unknown";

/**
 * `unknown` when the cached viewer predates the field: the control stays, and
 * a refusal explains itself in the toast — better than hiding a feature from a
 * supporter because their cache is a week old.
 */
export function pinAbility(viewer: DonatorFields | null | undefined): PinAbility {
  if (!viewer || viewer.donatorTier === undefined) return "unknown";
  return (viewer.donatorTier ?? 0) >= PIN_TIER ? "yes" : "no";
}

/**
 * Whether the pin toggle belongs on one of the viewer's own activities.
 *
 * A pinned activity keeps its toggle whatever the tier: a supporter whose
 * donation lapsed must still be able to unpin, and unpinning is not the call
 * AniList gates. Nothing here is a disabled state — a button that can only
 * fail is worse than no button.
 */
export function canTogglePin(
  viewer: DonatorFields | null | undefined,
  item: { isPinned: boolean },
  self: boolean,
): boolean {
  if (!self) return false;
  return item.isPinned || pinAbility(viewer) !== "no";
}
