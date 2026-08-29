/**
 * HTML entity decoding, shared by both text parsers.
 *
 * It lived in `anilistHtml.ts` first, which is why descriptions decoded
 * `&amp;` for years while bios showed it literally: `anilistMarkdown.ts`
 * never had the branch, and a real profile renders as `&nbsp;` and
 * `&#x2605;` on screen. One module, two importers, so the two parsers can
 * never disagree about what an entity means.
 *
 * A closed table rather than a DOM round trip: `innerHTML = s; return
 * textContent` is the usual trick and it is exactly the thing the tree
 * parsers exist to avoid. The table is the entities real AniList content
 * uses — core escapes, typography, and the punctuation/symbol names profile
 * art leans on — not the full HTML5 list. An unknown name stays literal,
 * which is the honest rendering of a typo.
 *
 * Documented limitation: names are looked up lowercased, so the case-variant
 * pairs (`&Dagger;` ‡ vs `&dagger;` †) collapse onto the lowercase glyph.
 */

/**
 * Matched at an explicit index with the callers' `at()` discipline: sticky,
 * `lastIndex` set before every exec, advanced by the match's own length.
 */
export const ENTITY_RE = /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/y;

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  // An explicit U+00A0, not a space: an author writing `&nbsp;` wants the
  // line not to break there, and collapsing it discards that.
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  // The decoration set, straight out of real bios: stars, arrows, slashes
  // and hearts between `<a>` tags is what profile art is made of.
  sol: "/",
  starf: "★",
  star: "☆",
  hearts: "♥",
  bull: "•",
  middot: "·",
  uarr: "↑",
  darr: "↓",
  larr: "←",
  rarr: "→",
  times: "×",
  copy: "©",
  deg: "°",
  laquo: "«",
  raquo: "»",
  dagger: "†",
  sect: "§",
  para: "¶",
  emsp: " ",
  ensp: " ",
  thinsp: " ",
};

/** Decodes one entity body (the part between `&` and `;`), or returns null
 *  to leave it as literal text. */
export function decodeEntity(body: string): string | null {
  if (body.startsWith("#")) {
    const hex = body[1] === "x" || body[1] === "X";
    const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
    // Surrogates and out-of-range values would produce a lone half or throw.
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;
    if (code >= 0xd800 && code <= 0xdfff) return null;
    return String.fromCodePoint(code);
  }
  return NAMED[body.toLowerCase()] ?? null;
}
