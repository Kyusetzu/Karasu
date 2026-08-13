import type { MdInline } from "./anilistMarkdown";

/**
 * AniList *descriptions*, which are HTML rather than markdown, parsed to the
 * same node union the markdown parser produces.
 *
 * Why this exists at all: the description was the last thing in the app rendered
 * through `dangerouslySetInnerHTML`. It went through a sanitizer,
 * `lib/description.ts`, which this module replaces and which is now deleted —
 * and that sanitizer's own comment recorded that *its* previous version had been
 * a live path from a description to script execution, because `\b` in a
 * tag-name regex matches at the space before an attribute, so
 * `<b onmouseover=…>` read as an allowed tag and passed through whole. It was
 * fixed by rebuilding each surviving tag from its name alone.
 *
 * That fix was correct and this replaces it anyway, for one reason: a sanitizer
 * has to be *right*, where a tree has nothing to be wrong about. The output here
 * is data, and the renderer maps data to elements — so there is no string for a
 * future edit to mishandle and no `__html` for anyone to reach for. The class of
 * bug is gone rather than defended against.
 *
 * Reusing `MdInline` rather than inventing a second union is what makes that
 * true cheaply: `strong`, `em`, `br` and `text` already exist, the renderer
 * already draws them, and the safety walk in `anilistMarkdown.test.ts` already
 * covers the shape.
 *
 * Deliberately the same five tags the sanitizer allowed — `b`, `strong`, `i`,
 * `em`, `br` — mapped to the three nodes that represent them. `<b>` and
 * `<strong>` render identically, as do `<i>` and `<em>`, so collapsing each
 * pair loses nothing visible.
 */

/** Matched at an explicit index; never advanced by `lastIndex`. See below. */
const RE = {
  /** `script` and `style` lose their contents too, not just their tags. */
  dropWhole: /<\s*(script|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/iy,
  dropDangling: /<\s*(?:script|style)\b[\s\S]*$/iy,
  open: /<\s*(b|strong|i|em)\b[^>]*>/iy,
  close: /<\s*\/\s*(b|strong|i|em)\s*>/iy,
  br: /<\s*br\s*\/?\s*>/iy,
  anyTag: /<\/?[a-zA-Z][^>]*>|<!--[\s\S]*?-->|<![^>]*>/y,
  dangling: /<\/?[a-zA-Z][^>]*$/y,
  /** AniList's spoiler markup, which descriptions use for plot reveals. */
  spoiler: /~!([\s\S]*?)!~/y,
  entity: /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/y,
};

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  // An explicit U+00A0, not a space: an author writing `&nbsp;` wants the
  // line not to break there, and collapsing it discards that.
  nbsp: "\u00a0",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

/**
 * Decodes one entity, or returns null to leave it as literal text.
 *
 * A closed table rather than a DOM round trip: `innerHTML = s; return textContent`
 * is the usual trick and it is exactly the thing this module exists to avoid.
 */
function entity(body: string): string | null {
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

/** Which node an open tag becomes. `b`/`strong` and `i`/`em` collapse. */
function nodeFor(tag: string): "strong" | "em" {
  const t = tag.toLowerCase();
  return t === "b" || t === "strong" ? "strong" : "em";
}

function at(re: RegExp, src: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(src);
}

interface Frame {
  type: "strong" | "em" | "spoiler";
  children: MdInline[];
}

/**
 * Parses a description. Never throws; always terminates.
 *
 * Nesting is tracked with an explicit stack rather than recursion, because the
 * input is stranger-written HTML with no guarantee the tags balance — a
 * recursive parser would need a depth cap and this one cannot overflow at all.
 * An unclosed tag simply keeps its children when the input ends, and a stray
 * close tag with no matching open is dropped.
 *
 * Every branch advances `i` by its match's own length, never by `lastIndex`:
 * these patterns are module-level objects, and reading regex state after any
 * other match has run is how the markdown parser once spun until the heap died.
 */
export function parseAniListHtml(html: string, limit = 8000): MdInline[] {
  const src = typeof html === "string" ? html.slice(0, limit) : "";
  const root: MdInline[] = [];
  const stack: Frame[] = [];
  let buf = "";

  const out = () => (stack.length ? stack[stack.length - 1].children : root);
  const flush = () => {
    if (buf) {
      out().push({ type: "text", text: buf });
      buf = "";
    }
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === "<") {
      const drop = at(RE.dropWhole, src, i) ?? at(RE.dropDangling, src, i);
      if (drop) {
        i += drop[0].length;
        continue;
      }
      const br = at(RE.br, src, i);
      if (br) {
        flush();
        out().push({ type: "br" });
        i += br[0].length;
        continue;
      }
      const open = at(RE.open, src, i);
      if (open) {
        flush();
        stack.push({ type: nodeFor(open[1]), children: [] });
        i += open[0].length;
        continue;
      }
      const close = at(RE.close, src, i);
      if (close) {
        const want = nodeFor(close[1]);
        // Only closes if something matching is actually open; a stray `</b>`
        // is dropped rather than unwinding a frame it never opened.
        const depth = stack.findIndex((f) => f.type === want);
        if (depth !== -1) {
          flush();
          // Unwind to it, so `<b><i>x</b>` closes both rather than leaking.
          while (stack.length > depth) {
            const frame = stack.pop()!;
            out().push({ type: frame.type, children: frame.children } as MdInline);
          }
        }
        i += close[0].length;
        continue;
      }
      // Every other tag, comment and doctype: gone, contents kept.
      const tag = at(RE.anyTag, src, i) ?? at(RE.dangling, src, i);
      if (tag) {
        i += tag[0].length;
        continue;
      }
    }

    if (c === "~") {
      const sp = at(RE.spoiler, src, i);
      if (sp) {
        flush();
        // Click-to-reveal rather than deletion. The old sanitizer removed
        // spoilers and their contents outright, which silently dropped part of
        // the synopsis; the app now has a spoiler node and the renderer keeps
        // the text out of the DOM until it is asked for.
        out().push({ type: "spoiler", children: parseAniListHtml(sp[1], limit) });
        i += sp[0].length;
        continue;
      }
    }

    if (c === "&") {
      const ent = at(RE.entity, src, i);
      if (ent) {
        const decoded = entity(ent[1]);
        if (decoded !== null) {
          buf += decoded;
          i += ent[0].length;
          continue;
        }
      }
    }

    buf += c;
    i += 1;
  }

  flush();
  // Anything still open keeps what it collected — an unbalanced description
  // should lose its emphasis, not its words.
  while (stack.length) {
    const frame = stack.pop()!;
    out().push({ type: frame.type, children: frame.children } as MdInline);
  }
  return root;
}

/** The visible text, for a length check or a preview. */
export function htmlToPlain(html: string): string {
  const walk = (nodes: MdInline[]): string =>
    nodes
      .map((n) => {
        if (n.type === "text") return n.text;
        if (n.type === "br") return " ";
        if ("children" in n) return walk(n.children);
        return "";
      })
      .join("");
  return walk(parseAniListHtml(html)).replace(/\s+/g, " ").trim();
}
