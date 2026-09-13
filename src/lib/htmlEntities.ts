/** HTML entity decoding shared by both text parsers, over the whole WHATWG table so a subset cannot drift from the browser. */

import { HTML5_ENTITIES } from "./htmlEntities.data";

/** Sticky and semicolon-required, so callers match at an explicit index and `AT&T` stays the text it is. */
export const ENTITY_RE = /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/y;

/** Decodes one entity body (the part between `&` and `;`), or returns null to leave it as literal text. */
export function decodeEntity(body: string): string | null {
  if (body.startsWith("#")) {
    const hex = body[1] === "x" || body[1] === "X";
    const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
    // Surrogates and out-of-range values would produce a lone half or throw.
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;
    if (code >= 0xd800 && code <= 0xdfff) return null;
    return String.fromCodePoint(code);
  }
  // An own-property check, not a bare lookup: `&constructor;` fits the pattern and a plain object answers it.
  return Object.prototype.hasOwnProperty.call(HTML5_ENTITIES, body) ? HTML5_ENTITIES[body] : null;
}
