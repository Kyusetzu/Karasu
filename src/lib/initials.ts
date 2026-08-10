/**
 * The single character an avatar disc shows when a user has no image.
 *
 * Takes the first *code point* rather than `name[0]` or `name.slice(0, 1)`,
 * which index UTF-16 units and so return half a surrogate pair — rendered as a
 * replacement glyph — for any name starting outside the BMP.
 *
 * Honest about what that buys: AniList does permit non-ASCII usernames (`あいん`
 * and `あおきり` are real accounts), but a sample turned up nothing astral, so
 * this is defensive rather than a fix for something reachable today. It costs
 * one destructure, and the alternative fails silently and only for the users
 * least likely to report it.
 *
 * Deliberately not `Intl.Segmenter`: a grapheme cluster can be an emoji ZWJ
 * sequence several code points wide, and a disc sized for one character would
 * be overrun by it. One code point is both correct UTF-16 handling and the
 * right visual bound.
 *
 * `toUpperCase`, not `toLocaleUpperCase` — the latter reads the *host* locale
 * with no argument, so the same username would show a different letter on a
 * Turkish system than on a German one.
 */
export function initialFor(name: string): string {
  const [first] = name.trim();
  return first ? first.toUpperCase() : "?";
}
