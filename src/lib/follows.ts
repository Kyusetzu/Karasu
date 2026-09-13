/** The four states between two AniList users, derived from `isFollowing` and `isFollower`; a "friend" is both at once. */
export type FollowRelation = "mutual" | "following" | "followsYou" | "none";

export interface FollowFlags {
  isFollowing?: boolean | null;
  isFollower?: boolean | null;
}

/** Null and undefined read as false, which fails safe: the button offers to follow and AniList's toggle decides. */
export function followRelation(flags: FollowFlags): FollowRelation {
  const following = flags.isFollowing === true;
  const follower = flags.isFollower === true;
  if (following && follower) return "mutual";
  if (following) return "following";
  if (follower) return "followsYou";
  return "none";
}

/** The relation after `ToggleFollow`; only your half changes, so it is its own inverse and the undo shares the path. */
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

/** The closed union of badge keys, literal per branch so `i18nKeys.test.ts` can see them. */
export type RelationBadgeKey = "social.badgeMutual" | "social.badgeFollowsYou";

/** The i18n key for a relation's badge, or null when there is nothing to say. */
export function relationBadgeKey(relation: FollowRelation): RelationBadgeKey | null {
  if (relation === "mutual") return "social.badgeMutual";
  if (relation === "followsYou") return "social.badgeFollowsYou";
  // "following" needs no badge: the button already says so, and labelling both says the same thing twice.
  return null;
}

/** Whether the viewer is looking at themselves; by id, never by name, since AniList lets a user rename. */
export function isSelf(viewerId: number | null | undefined, userId: number): boolean {
  return viewerId != null && viewerId === userId;
}
