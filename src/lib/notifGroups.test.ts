import { describe, expect, it } from "vitest";
import { buildGroups, unify, type UnifiedNotif } from "./notifGroups";
import type { AppNotification } from "@/api/anilist";
import type { SiteNotifRow } from "./siteNotifications";

const HOUR = 60 * 60 * 1000;

const local = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: 1,
  kind: "airing",
  title: "Some Show",
  body: "Episode 3 is out.",
  createdMs: 1_000_000_000_000,
  mediaId: 55,
  read: false,
  ...over,
});

const site = (over: Partial<SiteNotifRow> = {}): SiteNotifRow => ({
  id: 1,
  kind: "ACTIVITY_LIKE",
  createdAt: 1_000_000_000,
  title: "Alice",
  actorName: "Alice",
  episode: null,
  detail: null,
  target: "/user/Alice",
  userId: 7,
  mediaId: null,
  activityId: 100,
  media: null,
  ...over,
});

/** A prepared item at an absolute time, for driving buildGroups directly. */
const at = (n: UnifiedNotif, ms: number): UnifiedNotif => ({ ...n, atMs: ms });

describe("unify", () => {
  it("normalizes seconds to milliseconds and sorts newest first", () => {
    const rows = unify(
      [local({ id: 1, createdMs: 5_000_000 })],
      [site({ id: 2, createdAt: 9_000 })],
      0,
    );
    expect(rows.map((r) => r.key)).toEqual(["site:2", "local:1"]);
    expect(rows[0].atMs).toBe(9_000_000);
  });

  it("marks the first siteUnseen site rows unread, feed order", () => {
    const rows = unify(
      [],
      [site({ id: 1 }), site({ id: 2 }), site({ id: 3 })],
      2,
    );
    expect(rows.map((r) => r.unread)).toEqual([true, true, false]);
  });

  it("carries local read state and identities through", () => {
    const [a, b] = unify(
      [local({ id: 1, read: true }), local({ id: 2, read: false, mediaId: null })],
      [],
      0,
    );
    expect(a.unread).toBe(false);
    expect(a.mediaId).toBe(55);
    expect(b.unread).toBe(true);
    expect(b.mediaId).toBeNull();
  });
});

describe("buildGroups", () => {
  const likeItem = (id: number, ms: number, activityId: number | null = id) =>
    at(unify([], [site({ id, activityId })], 0)[0], ms);

  it("collapses one actor's likes and counts distinct activities", () => {
    const items = [
      likeItem(1, 10 * HOUR, 100),
      likeItem(2, 9 * HOUR, 101),
      likeItem(3, 8 * HOUR, 100), // the same post liked again
    ];
    const groups = buildGroups(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toEqual({ kind: "likes", name: "Alice", n: 2 });
    expect(groups[0].items).toHaveLength(3);
  });

  it("falls back to the item count when activity ids are missing", () => {
    const items = [likeItem(1, 2 * HOUR, null), likeItem(2, 1 * HOUR, null)];
    expect(buildGroups(items)[0].label).toEqual({ kind: "likes", name: "Alice", n: 2 });
  });

  it("different actors never share a group", () => {
    const a = unify([], [site({ id: 1, userId: 7 })], 0)[0];
    const b = unify([], [site({ id: 2, userId: 8 })], 0)[0];
    const groups = buildGroups([at(a, 2 * HOUR), at(b, 1 * HOUR)]);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBeNull();
  });

  it("seals a bucket past the 48h window and merges within it", () => {
    const items = [
      likeItem(1, 100 * HOUR),
      likeItem(2, 100 * HOUR - 48 * HOUR), // exactly at the window: joins
      likeItem(3, 100 * HOUR - 49 * HOUR), // past it against the *newest*: new bucket
    ];
    const groups = buildGroups(items);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toHaveLength(1);
  });

  it("merges non-adjacent same-key items across whatever sat between", () => {
    const a = likeItem(1, 10 * HOUR);
    const other = at(unify([], [site({ id: 9, kind: "FOLLOWING", activityId: null })], 0)[0], 9 * HOUR);
    const b = likeItem(2, 8 * HOUR);
    const groups = buildGroups([a, other, b]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((i) => i.key)).toEqual(["site:1", "site:2"]);
  });

  it("groups airing across the two sources by media id", () => {
    const s = at(unify([], [site({ id: 1, kind: "AIRING", userId: null, activityId: null, mediaId: 55, title: "Some Show", actorName: null, episode: 4 })], 0)[0], 3 * HOUR);
    const l = at(unify([local({ id: 2, mediaId: 55 })], [], 0)[0], 2 * HOUR);
    const groups = buildGroups([s, l]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toEqual({ kind: "airing", title: "Some Show", n: 2 });
  });

  it("airing for different media stays apart, and a null media id stands alone", () => {
    const a = at(unify([local({ id: 1, mediaId: 55 })], [], 0)[0], 3 * HOUR);
    const b = at(unify([local({ id: 2, mediaId: 66 })], [], 0)[0], 2 * HOUR);
    const c = at(unify([local({ id: 3, mediaId: null })], [], 0)[0], 1 * HOUR);
    expect(buildGroups([a, b, c])).toHaveLength(3);
  });

  it("passes the other sixteen kinds through as singletons", () => {
    const rows = ["FOLLOWING", "THREAD_LIKE", "MEDIA_MERGE"].map((kind, i) =>
      at(unify([], [site({ id: i + 1, kind: kind as SiteNotifRow["kind"], activityId: null })], 0)[0], (3 - i) * HOUR),
    );
    const groups = buildGroups(rows);
    expect(groups).toHaveLength(3);
    for (const g of groups) expect(g.label).toBeNull();
  });

  it("propagates unread when any member is unread", () => {
    const read = { ...likeItem(1, 2 * HOUR), unread: false };
    const fresh = { ...likeItem(2, 1 * HOUR), unread: true };
    expect(buildGroups([read, fresh])[0].unread).toBe(true);
    expect(buildGroups([read, { ...fresh, unread: false }])[0].unread).toBe(false);
  });

  it("keeps a stable group key as older members join from a later page", () => {
    const first = [likeItem(1, 10 * HOUR)];
    const more = [likeItem(1, 10 * HOUR), likeItem(2, 9 * HOUR)];
    expect(buildGroups(first)[0].key).toBe(buildGroups(more)[0].key);
  });

  it("orders groups by their newest member", () => {
    const l = at(unify([local({ id: 1, kind: "stale", mediaId: null })], [], 0)[0], 5 * HOUR);
    const g1 = likeItem(2, 6 * HOUR);
    const g2 = likeItem(3, 4 * HOUR);
    const groups = buildGroups([g1, l, g2]);
    expect(groups.map((g) => g.atMs)).toEqual([6 * HOUR, 5 * HOUR]);
  });
});
