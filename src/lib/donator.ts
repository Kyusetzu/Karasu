/** Gate on `donatorTier`, never on `donatorBadge`: AniList returns the default "Donator" label for every account. */
export interface DonatorFields {
  donatorTier?: number | null;
  donatorBadge?: string | null;
}

export function donatorLabel(user: DonatorFields): string | null {
  const tier = user.donatorTier ?? 0;
  if (tier <= 0) return null;
  const badge = user.donatorBadge?.trim();
  // A supporter who never customised it still has the default label, so the fallback is the same word.
  return badge || "Donator";
}

// --- What the tier lets the account do: pinning is gated, so the control is not offered where it can only fail ---

/** The tier AniList asks for before it lets an activity be pinned. */
export const PIN_TIER = 2;

export type PinAbility = "yes" | "no" | "unknown";

/** `unknown` when the cached viewer predates the field, so the control stays and a refusal explains itself in the toast. */
export function pinAbility(viewer: DonatorFields | null | undefined): PinAbility {
  if (!viewer || viewer.donatorTier === undefined) return "unknown";
  return (viewer.donatorTier ?? 0) >= PIN_TIER ? "yes" : "no";
}

/** Whether the pin toggle belongs on the viewer's own activity; a pinned one keeps it, since unpinning is not gated. */
export function canTogglePin(
  viewer: DonatorFields | null | undefined,
  item: { isPinned: boolean },
  self: boolean,
): boolean {
  if (!self) return false;
  return item.isPinned || pinAbility(viewer) !== "no";
}
