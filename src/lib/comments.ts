import type { SocialUser } from "@/api/social";

/** Thread comments flattened to two levels, the rest reported as hidden; `childComments` is an untyped blob. */

export interface FlatComment {
  id: number;
  comment: string;
  createdAt: number;
  likeCount: number;
  isLiked: boolean;
  siteUrl: string;
  user: SocialUser | null;
  /** 0 for a top-level comment, 1 for a reply; never deeper. */
  depth: 0 | 1;
  /** The top-level row this belongs to, itself at depth 0; parent replies here or they land past the cap and vanish. */
  rootId: number;
  /** Replies that exist but sit below the depth cap. */
  hiddenReplies: number;
}

/** As it arrives: anything at all, because `childComments` is untyped. */
type RawComment = {
  id?: unknown;
  comment?: unknown;
  createdAt?: unknown;
  likeCount?: unknown;
  isLiked?: unknown;
  siteUrl?: unknown;
  user?: unknown;
  childComments?: unknown;
};

function asUser(value: unknown): SocialUser | null {
  if (!value || typeof value !== "object") return null;
  const u = value as Record<string, unknown>;
  if (typeof u.id !== "number" || typeof u.name !== "string") return null;
  const avatar =
    u.avatar && typeof u.avatar === "object"
      ? { medium: (u.avatar as Record<string, unknown>).medium as string | null }
      : null;
  return {
    id: u.id,
    name: u.name,
    avatar,
    isFollowing: typeof u.isFollowing === "boolean" ? u.isFollowing : null,
    isFollower: typeof u.isFollower === "boolean" ? u.isFollower : null,
  };
}

/** Counts every descendant, so a truncated chain can say how much it is hiding. */
function countDescendants(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  let n = 0;
  for (const child of value) {
    n += 1;
    if (child && typeof child === "object") {
      n += countDescendants((child as RawComment).childComments);
    }
  }
  return n;
}

function normalize(raw: unknown, depth: 0 | 1): FlatComment | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as RawComment;
  if (typeof c.id !== "number") return null;
  const comment = typeof c.comment === "string" ? c.comment : "";
  return {
    id: c.id,
    comment,
    createdAt: typeof c.createdAt === "number" ? c.createdAt : 0,
    likeCount: typeof c.likeCount === "number" ? c.likeCount : 0,
    isLiked: c.isLiked === true,
    siteUrl: typeof c.siteUrl === "string" ? c.siteUrl : "",
    user: asUser(c.user),
    depth,
    // Seeded to itself so a normalized row is never parentless; the caller overwrites it with the real root.
    rootId: c.id,
    hiddenReplies: 0,
  };
}

/** Flattens a page to two levels in reading order; a malformed `childComments` yields no replies rather than a throw. */
export function flattenComments(rows: unknown): FlatComment[] {
  if (!Array.isArray(rows)) return [];
  const out: FlatComment[] = [];

  for (const row of rows) {
    const top = normalize(row, 0);
    if (!top) continue;
    top.rootId = top.id;

    const children = (row as RawComment)?.childComments;
    const kids = Array.isArray(children) ? children : [];
    const direct: FlatComment[] = [];
    let hidden = 0;

    for (const kid of kids) {
      const reply = normalize(kid, 1);
      if (!reply) continue;
      // Parented to the top-level row, not to `reply.id`; the subtree past the cap is counted so the row can say so.
      reply.rootId = top.id;
      reply.hiddenReplies = countDescendants((kid as RawComment)?.childComments);
      hidden += reply.hiddenReplies;
      direct.push(reply);
    }

    // The parent reports what its own subtree hides beyond level one.
    top.hiddenReplies = hidden;
    out.push(top, ...direct);
  }

  return out;
}


/** The row `flattenComments` will draw for `targetId`: itself (`exact`), its nearest drawable ancestor, or null. */
export function visibleAnchor(
  rows: unknown,
  targetId: number,
): { id: number; exact: boolean } | null {
  if (!Array.isArray(rows)) return null;
  const contains = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return false;
    const n = node as RawComment;
    if (n.id === targetId) return true;
    const kids = Array.isArray(n.childComments) ? n.childComments : [];
    return kids.some(contains);
  };
  for (const row of rows) {
    const top = row as RawComment;
    if (!top || typeof top !== "object" || typeof top.id !== "number") continue;
    if (top.id === targetId) return { id: top.id, exact: true };
    const kids = Array.isArray(top.childComments) ? top.childComments : [];
    for (const kid of kids) {
      const k = kid as RawComment;
      if (!k || typeof k !== "object" || typeof k.id !== "number") continue;
      if (k.id === targetId) return { id: k.id, exact: true };
      if (contains(k)) return { id: k.id, exact: false };
    }
    // Under this top but under no drawable child — a malformed kid subtree.
    if (contains(top)) return { id: top.id, exact: false };
  }
  return null;
}
