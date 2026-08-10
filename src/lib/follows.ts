/**
 * The four states a relationship between two AniList users can be in.
 *
 * AniList has no "friend". It has two independent booleans — `isFollowing` (you
 * follow them) and `isFollower` (they follow you) — and the thing people mean by
 * a friend is both at once. Deriving that here rather than in a component keeps
 * it testable and keeps the four cases in one place, because the button label,
 * the badge and what a click does all depend on the same answer.
 */
export type FollowRelation = "mutual" | "following" | "followsYou" | "none";

export interface FollowFlags {
  isFollowing?: boolean | null;
  isFollower?: boolean | null;
}

/**
 * Null and undefined read as false.
 *
 * They are not the same thing to the API — a signed-out request returns `false`
 * for both regardless of the truth — but nothing downstream can act on the
 * difference, and treating "unknown" as "not following" fails safe: the button
 * offers to follow, and AniList's own toggle is the authority on what happens.
 */
export function followRelation(flags: FollowFlags): FollowRelation {
  const following = flags.isFollowing === true;
  const follower = flags.isFollower === true;
  if (following && follower) return "mutual";
  if (following) return "following";
  if (follower) return "followsYou";
  return "none";
}

/**
 * The relation after a successful `ToggleFollow`.
 *
 * Only your own half changes: whether *they* follow *you* is not yours to
 * toggle. That makes the function an involution — applying it twice returns the
 * original — which is what lets the optimistic patch and its undo share one
 * code path instead of having a separate rollback.
 */
export function nextRelation(relation: FollowRelation): FollowRelation {
  switch (relation) {
    case "none":
      return "following";
    case "following":
      return "none";
    case "followsYou":
      return "mutual";
    case "mutual":
      return "followsYou";
  }
}

/** The flags implied by a relation, for patching a cached user in place. */
export function relationFlags(relation: FollowRelation): {
  isFollowing: boolean;
  isFollower: boolean;
} {
  return {
    isFollowing: relation === "following" || relation === "mutual",
    isFollower: relation === "followsYou" || relation === "mutual",
  };
}

/** Whether the viewer already follows them — what the button's state hangs on. */
export function isFollowing(relation: FollowRelation): boolean {
  return relation === "following" || relation === "mutual";
}

/**
 * The i18n key for a relation's badge, or null when there is nothing to say.
 *
 * A literal key per branch rather than a template, because `i18nKeys.test.ts`
 * only sees literal `t("…")` calls and a template-built key is invisible to it.
 * `receiptText` in `useListMutations` established the pattern: the pure function
 * returns a member of a closed union and the component maps it through a
 * literal switch.
 */
export type RelationBadgeKey = "social.badgeMutual" | "social.badgeFollowsYou";

export function relationBadgeKey(relation: FollowRelation): RelationBadgeKey | null {
  if (relation === "mutual") return "social.badgeMutual";
  if (relation === "followsYou") return "social.badgeFollowsYou";
  // "following" needs no badge — the button already says so, and labelling both
  // is how a row ends up saying the same thing twice.
  return null;
}

/**
 * Whether this is the viewer looking at themselves.
 *
 * By id, never by name: AniList lets a user rename, `previousNames` exists
 * because of it, and a stale cached name would otherwise offer someone a follow
 * button pointed at their own account.
 */
export function isSelf(viewerId: number | null | undefined, userId: number): boolean {
  return viewerId != null && viewerId === userId;
}
