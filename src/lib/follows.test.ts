import { describe, expect, it } from "vitest";
import {
  followRelation,
  isFollowing,
  isSelf,
  nextRelation,
  relationBadgeKey,
  relationFlags,
  type FollowRelation,
} from "./follows";

const ALL: FollowRelation[] = ["mutual", "following", "followsYou", "none"];

describe("followRelation", () => {
  it("maps all four combinations", () => {
    expect(followRelation({ isFollowing: true, isFollower: true })).toBe("mutual");
    expect(followRelation({ isFollowing: true, isFollower: false })).toBe("following");
    expect(followRelation({ isFollowing: false, isFollower: true })).toBe("followsYou");
    expect(followRelation({ isFollowing: false, isFollower: false })).toBe("none");
  });

  it("treats null, undefined and absent as not-following", () => {
    // A signed-out request returns false for both no matter the truth, and an
    // unknown flag has to fail safe — offering a follow is recoverable, claiming
    // a relationship that does not exist is not.
    expect(followRelation({})).toBe("none");
    expect(followRelation({ isFollowing: null, isFollower: null })).toBe("none");
    expect(followRelation({ isFollowing: undefined, isFollower: true })).toBe("followsYou");
  });
});

describe("nextRelation", () => {
  it("toggles only the viewer's own half", () => {
    expect(nextRelation("none")).toBe("following");
    expect(nextRelation("following")).toBe("none");
    // Whether they follow you is not yours to change.
    expect(nextRelation("followsYou")).toBe("mutual");
    expect(nextRelation("mutual")).toBe("followsYou");
  });

  it("is its own inverse, which is what makes undo one code path", () => {
    for (const r of ALL) expect(nextRelation(nextRelation(r))).toBe(r);
  });

  it("never changes the follower half", () => {
    for (const r of ALL) {
      expect(relationFlags(nextRelation(r)).isFollower).toBe(relationFlags(r).isFollower);
    }
  });
});

describe("relationFlags", () => {
  it("round-trips through followRelation for every relation", () => {
    for (const r of ALL) expect(followRelation(relationFlags(r))).toBe(r);
  });
});

describe("isFollowing", () => {
  it("is true exactly when the viewer follows them", () => {
    expect(isFollowing("following")).toBe(true);
    expect(isFollowing("mutual")).toBe(true);
    expect(isFollowing("followsYou")).toBe(false);
    expect(isFollowing("none")).toBe(false);
  });

  it("agrees with the flags it was derived from", () => {
    for (const r of ALL) expect(isFollowing(r)).toBe(relationFlags(r).isFollowing);
  });
});

describe("relationBadgeKey", () => {
  it("labels the two relations the button does not already state", () => {
    expect(relationBadgeKey("mutual")).toBe("social.badgeMutual");
    expect(relationBadgeKey("followsYou")).toBe("social.badgeFollowsYou");
  });

  it("says nothing when the button already says it", () => {
    expect(relationBadgeKey("following")).toBeNull();
    expect(relationBadgeKey("none")).toBeNull();
  });

  it("returns only keys from the closed union, so i18nKeys can see them", () => {
    const allowed = new Set(["social.badgeMutual", "social.badgeFollowsYou", null]);
    for (const r of ALL) expect(allowed.has(relationBadgeKey(r))).toBe(true);
  });
});

describe("isSelf", () => {
  it("matches on id", () => {
    expect(isSelf(7, 7)).toBe(true);
    expect(isSelf(7, 8)).toBe(false);
  });

  it("is false when there is no viewer, rather than throwing", () => {
    expect(isSelf(null, 7)).toBe(false);
    expect(isSelf(undefined, 7)).toBe(false);
  });

  it("does not treat id 0 as absent", () => {
    // `viewerId != null` rather than a truthiness check: AniList ids start at 1,
    // but a truthy test here is the kind of thing that survives until it does not.
    expect(isSelf(0, 0)).toBe(true);
    expect(isSelf(0, 1)).toBe(false);
  });
});
