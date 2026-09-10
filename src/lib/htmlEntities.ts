/**
 * HTML entity decoding, shared by both text parsers.
 *
 * It lived in `anilistHtml.ts` first, which is why descriptions decoded
 * `&amp;` for years while bios showed it literally: `anilistMarkdown.ts`
 * never had the branch, and a real profile renders as `&nbsp;` and
 * `&#x2605;` on screen. One module, two importers, so the two parsers can
 * never disagree about what an entity means.
 *
 * A table rather than a DOM round trip: `innerHTML = s; return textContent`
 * is the usual trick and it is exactly the thing the tree parsers exist to
 * avoid. The table is the whole WHATWG list (`htmlEntities.data.ts`, written
 * by `scripts/gen-entities.mjs`), not a hand-picked subset. A subset was
 * tried — "the entities real AniList content uses" — and was wrong within the
 * month: anilist.co leaves entities in its HTML for the browser to decode, so
 * the site showed a bio's `&plus;` as `+` and Karasu showed the seven
 * characters. Whatever a browser decodes, this decodes; an unknown name stays
 * literal, which is the honest rendering of a typo.
 *
 * Names are case-sensitive, as in a browser: `&Dagger;` is ‡, `&dagger;` is
 * †, and `&NBSP;` is nothing. The 106 legacy names a browser also accepts
 * without the semicolon (`&amp`, `&copy`) are deliberately not matched —
 * `ENTITY_RE` requires the `;` — so `AT&T` and `a &b` remain the text they
 * are.
 */

import { HTML5_ENTITIES } from "./htmlEntities.data";

/**
 * Matched at an explicit index with the callers' `at()` discipline: sticky,
 * `lastIndex` set before every exec, advanced by the match's own length.
 * The longest name in the table is 31 characters.
 */
export const ENTITY_RE = /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/y;

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
  // An own-property check, not a bare lookup: `&constructor;` fits the
  // pattern, and a plain object answers it with a function.
  return Object.prototype.hasOwnProperty.call(HTML5_ENTITIES, body) ? HTML5_ENTITIES[body] : null;
}
