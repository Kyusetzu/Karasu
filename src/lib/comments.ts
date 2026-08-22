import type { SocialUser } from "@/api/social";

/**
 * AniList's thread comments, flattened to something renderable.
 *
 * `ThreadComment.childComments` is a raw `Json` scalar, not a typed connection:
 * there is no way to select its shape, no way to limit its depth, and no
 * guarantee about what arrives. That is the entire reason this is pure logic
 * with tests rather than a `.map()` in a component.
 *
 * Two measurements that shaped the decisions here, both taken against thread
 * 12753 (a 4,500-comment forum game):
 *
 * - **Asking for `childComments` costs 13×.** Twelve comments came to 52,801
 *   bytes with it and 3,964 bytes without. It is all-or-nothing, so the page
 *   size is capped low to compensate rather than the field being dropped —
 *   replies are most of what a thread *is*, and it is one request either way.
 * - **The nesting reaches 48 levels.** A reply chain that deep cannot be
 *   rendered as a tree in a tracker's side panel and would not be readable if it
 *   were, so it is flattened to two levels and the rest is a link to AniList.
 *   Most of that 52 kB is therefore discarded on purpose; the alternative is a
 *   per-comment expander that cannot know whether it will find anything, since
 *   the child count is only inside the blob.
 */

export interface FlatComment {
  id: number;
  comment: string;
  createdAt: number;
  likeCount: number;
  isLiked: boolean;
  siteUrl: string;
  user: SocialUser | null;
  /** 0 for a top-level comment, 1 for a reply. Never deeper — see above. */
  depth: 0 | 1;
  /**
   * The top-level comment this row belongs to — itself, when `depth` is 0.
   *
   * **This is what a reply must be parented to.** AniList nests arbitrarily
   * deep, but only two levels are rendered: a comment parented to a *reply*
   * lands at depth 2, which `flattenComments` folds into `hiddenReplies` and
   * never draws. Posting one therefore succeeds and then vanishes, with the
   * only trace being a "N more on AniList" counter ticking up. Measured chains
   * run 48 deep, so that is the ordinary case rather than an edge.
   */
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
    // Overwritten by the caller, which is the only place that knows the row
    // this one hangs off. Seeded to itself so a normalized row is never
    // parentless, whatever path reaches it.
    rootId: c.id,
    hiddenReplies: 0,
  };
}

/**
 * Flattens a page of comments to at most two levels, in reading order.
 *
 * Never throws. A malformed or unexpected `childComments` yields no replies
 * rather than taking the whole thread down — the field is untyped, so "unexpected"
 * is a normal outcome rather than a defensive hypothetical.
 */
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
      // Everything below this reply is beyond the cap; count it so the row can
      // say so instead of silently losing a conversation.
      // Parented to the top-level row, not to `reply.id` — see `rootId`.
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
