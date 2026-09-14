/** The one mapping from AniList's URL space onto app routes; anything Karasu draws less capably stays external. */

/** `anilist.co` and `www.anilist.co`, http or https, nothing else. */
const HOST = /^https?:\/\/(?:www\.)?anilist\.co\//i;

const RULES: [RegExp, (m: RegExpExecArray) => string][] = [
  // The slug after the id is decorative and optional, on every media URL.
  [/^(?:anime|manga)\/(\d+)(?:\/|$)/i, (m) => `/media/${m[1]}`],
  // A comment permalink carries its comment; keep it before the plain thread rule, or the shorter pattern eats it.
  [
    /^forum\/thread\/(\d+)\/comment\/(\d+)(?:\/|$)/i,
    (m) => `/thread/${m[1]}?comment=${m[2]}`,
  ],
  [/^forum\/thread\/(\d+)(?:\/|$)/i, (m) => `/thread/${m[1]}`],
  // Landed by the bell's activity notifications too, not just pasted links.
  [/^activity\/(\d+)(?:\/|$)/i, (m) => `/activity/${m[1]}`],
  [/^user\/([A-Za-z0-9_-]+)(?:\/|$)/, (m) => `/user/${encodeURIComponent(m[1])}`],
  [/^character\/(\d+)(?:\/|$)/i, (m) => `/character/${m[1]}`],
  [/^staff\/(\d+)(?:\/|$)/i, (m) => `/staff/${m[1]}`],
  [/^studio\/(\d+)(?:\/|$)/i, (m) => `/studio/${m[1]}`],
];

/** The internal route for an AniList URL, or `null` to open it externally; query and fragment are stripped first. */
export function internalRoute(href: string): string | null {
  if (!HOST.test(href)) return null;
  const path = href.replace(HOST, "").replace(/[?#].*$/, "");
  for (const [re, to] of RULES) {
    const m = re.exec(path);
    if (m) return to(m);
  }
  return null;
}

/** How to ask for a profile from the route param: digits are an id, as `User.siteUrl` and the website spell it. */
export function profileKey(param: string): { id: number } | { name: string } {
  return /^\d+$/.test(param) ? { id: Number(param) } : { name: param };
}
