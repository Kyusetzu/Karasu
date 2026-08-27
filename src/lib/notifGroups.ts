import type { AppNotification } from "@/api/anilist";
import type { SiteNotifRow } from "./siteNotifications";

/**
 * One stream for the bell, and the grouping of its bursts.
 *
 * Karasu's own rows and AniList's feed used to live on two tabs; here they
 * become one chronological stream, and runs of the same news — one person
 * liking five activities, three episodes airing back to back — collapse into
 * a single row. Everything is presentation: nothing here is stored, nothing
 * survives the query cache, and a "Load more" simply recomputes over the
 * larger set (a group may grow when older members surface — that is correct,
 * not a glitch).
 *
 * Unread on site rows is an honest approximation, stated as such: AniList has
 * no per-row read bit, only a count the first page's fetch resets. The bell
 * snapshots that count before it is reset and passes it as `siteUnseen`; the
 * first N site rows wear the dot.
 *
 * The one *cross-source* group key is airing-by-media, and it leans on a
 * guarantee the Rust side already makes: `alerts/airing.rs` writes no local
 * row when the account's own AniList AIRING notifications are on, so the two
 * sources never describe the same episode and the group never double-counts.
 * No other cross-source dedup exists, on purpose.
 */

export interface UnifiedNotif {
  /** `local:<id>` | `site:<id>` — stable across recomputes, safe as a React key. */
  key: string;
  source: "local" | "site";
  /** `AppNotification.kind` or `SiteNotifKind`, verbatim. */
  kind: string;
  atMs: number;
  unread: boolean;
  actorId: number | null;
  mediaId: number | null;
  activityId: number | null;
  /** Exactly one of these is set; the renderer keeps per-source markup. */
  local?: AppNotification;
  site?: SiteNotifRow;
}

export type GroupLabel =
  | { kind: "likes"; name: string; n: number }
  | { kind: "replyLikes"; name: string; n: number }
  | { kind: "replies"; name: string; n: number }
  | { kind: "airing"; title: string; n: number };

export interface NotifGroup {
  key: string;
  /** Newest first, like the stream they came from. */
  items: UnifiedNotif[];
  /** The newest member's time. */
  atMs: number;
  /** Any member unread. */
  unread: boolean;
  /** null → render `items[0]` as an ordinary row. */
  label: GroupLabel | null;
}

/** Two days: an evening's like-spree groups, a months-later like does not. */
const WINDOW_MS = 48 * 60 * 60 * 1000;

export function unify(
  local: AppNotification[],
  site: SiteNotifRow[],
  siteUnseen: number,
): UnifiedNotif[] {
  const out: UnifiedNotif[] = [];
  for (const n of local) {
    out.push({
      key: `local:${n.id}`,
      source: "local",
      kind: n.kind,
      atMs: n.createdMs,
      unread: !n.read,
      actorId: null,
      mediaId: n.mediaId,
      activityId: null,
      local: n,
    });
  }
  site.forEach((r, i) => {
    out.push({
      key: `site:${r.id}`,
      source: "site",
      kind: r.kind,
      // AniList speaks unix seconds, the local table milliseconds.
      atMs: r.createdAt * 1000,
      unread: i < siteUnseen,
      actorId: r.userId,
      mediaId: r.mediaId,
      activityId: r.activityId,
      site: r,
    });
  });
  return out.sort((a, b) => b.atMs - a.atMs);
}

/** The identity a run collapses on, or null for a row that stands alone. */
function groupKey(n: UnifiedNotif): string | null {
  if (n.source === "site" && n.actorId != null) {
    if (n.kind === "ACTIVITY_LIKE") return `ACTIVITY_LIKE:u${n.actorId}`;
    if (n.kind === "ACTIVITY_REPLY_LIKE") return `ACTIVITY_REPLY_LIKE:u${n.actorId}`;
    if (n.kind === "ACTIVITY_REPLY") return `ACTIVITY_REPLY:u${n.actorId}`;
  }
  const airing =
    (n.source === "site" && n.kind === "AIRING") ||
    (n.source === "local" && n.kind === "airing");
  if (airing && n.mediaId != null) return `AIRING:m${n.mediaId}`;
  return null;
}

/** Likes are counted by distinct activity, so liking one post twice is one. */
function distinctCount(items: UnifiedNotif[]): number {
  const ids = new Set<number>();
  for (const n of items) if (n.activityId != null) ids.add(n.activityId);
  return ids.size > 0 ? ids.size : items.length;
}

function labelFor(items: UnifiedNotif[]): GroupLabel | null {
  if (items.length < 2) return null;
  const first = items[0];
  const name = first.site?.actorName ?? "—";
  switch (first.kind) {
    case "ACTIVITY_LIKE":
      return { kind: "likes", name, n: distinctCount(items) };
    case "ACTIVITY_REPLY_LIKE":
      return { kind: "replyLikes", name, n: distinctCount(items) };
    case "ACTIVITY_REPLY":
      return { kind: "replies", name, n: distinctCount(items) };
    default: {
      const title = first.site?.title ?? first.local?.title ?? "—";
      return { kind: "airing", title, n: items.length };
    }
  }
}

/**
 * `items` must be sorted newest first — `unify` returns them that way.
 *
 * Each group key holds one *open* bucket: an item joins while it is within
 * the window of the bucket's newest member, otherwise the bucket seals and a
 * new one starts — so a like from March never rides October's group, while
 * non-adjacent likes inside the window still merge across whatever sat
 * between them.
 */
export function buildGroups(items: UnifiedNotif[]): NotifGroup[] {
  const buckets: { key: string | null; items: UnifiedNotif[] }[] = [];
  const open = new Map<string, { items: UnifiedNotif[]; newestAtMs: number }>();
  for (const n of items) {
    const k = groupKey(n);
    if (k === null) {
      buckets.push({ key: null, items: [n] });
      continue;
    }
    const bucket = open.get(k);
    if (bucket && bucket.newestAtMs - n.atMs <= WINDOW_MS) {
      bucket.items.push(n);
      continue;
    }
    const fresh = { key: k, items: [n] };
    buckets.push(fresh);
    open.set(k, { items: fresh.items, newestAtMs: n.atMs });
  }
  return buckets.map((b) => ({
    // The newest member's key makes the group's identity stable across
    // recomputes even as older members join from a later page.
    key: b.key ? `${b.key}@${b.items[0].key}` : b.items[0].key,
    items: b.items,
    atMs: b.items[0].atMs,
    unread: b.items.some((n) => n.unread),
    label: labelFor(b.items),
  }));
}
