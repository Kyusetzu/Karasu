/**
 * Which AniList URLs this app can answer itself.
 *
 * A link in a bio or a comment that points at `anilist.co/user/hori` used to
 * open the browser, sign-in state and all, for a page Karasu draws natively.
 * `internalRoute` is the one mapping from AniList's URL space onto the app's
 * routes; `RichText`'s link case consults it, which covers bios, comments,
 * thread bodies, activities and autolinks in a single place.
 *
 * What deliberately maps to `null`, and therefore stays external:
 *
 * - **Activity permalinks** (`/activity/N`) — there is no `/activity/:id`
 *   route to land on.
 * - **Forum category and search pages** (`/forum/overview`,
 *   `/forum/recent?category=…`) — Karasu's forum index is deliberately not a
 *   browsable mirror of the website's.
 * - **Settings, reviews, everything else** — a link should never land
 *   somewhere less capable than the page it named.
 * - **Every other host.** This is a router, not an opener; the caller keeps
 *   its external path for whatever this refuses.
 *
 * The user route is by *name* on purpose — that is what AniList's own URLs
 * carry (`App.tsx` documents the same decision for `@mention`s).
 */

/** `anilist.co` and `www.anilist.co`, http or https, nothing else. */
const HOST = /^https?:\/\/(?:www\.)?anilist\.co\//i;

const RULES: [RegExp, (m: RegExpExecArray) => string][] = [
  // The slug after the id is decorative and optional, on every media URL.
  [/^(?:anime|manga)\/(\d+)(?:\/|$)/i, (m) => `/media/${m[1]}`],
  // A comment permalink still lands on its thread — the app has no
  // per-comment anchor, and the thread is where the conversation is.
  [/^forum\/thread\/(\d+)(?:\/|$)/i, (m) => `/thread/${m[1]}`],
  [/^user\/([A-Za-z0-9_-]+)(?:\/|$)/, (m) => `/user/${encodeURIComponent(m[1])}`],
  [/^character\/(\d+)(?:\/|$)/i, (m) => `/character/${m[1]}`],
  [/^staff\/(\d+)(?:\/|$)/i, (m) => `/staff/${m[1]}`],
  [/^studio\/(\d+)(?:\/|$)/i, (m) => `/studio/${m[1]}`],
];

/**
 * The internal route for an AniList URL, or `null` for "open it externally".
 *
 * Query strings and fragments are stripped before matching: AniList tacks
 * `?ref=` style parameters onto shared links, and none of the mapped pages
 * read them.
 */
export function internalRoute(href: string): string | null {
  if (!HOST.test(href)) return null;
  const path = href.replace(HOST, "").replace(/[?#].*$/, "");
  for (const [re, to] of RULES) {
    const m = re.exec(path);
    if (m) return to(m);
  }
  return null;
}
