import type { MdInline } from "./anilistMarkdown";
import { ENTITY_RE, decodeEntity } from "./htmlEntities";

/** AniList descriptions are HTML, not markdown; parsed to `MdInline` nodes so no `__html` string ever exists. */

/** Matched at an explicit index through `at`; never advanced by `lastIndex`. */
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
};

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

/** Parses a description on an explicit stack; every branch advances by match length, never by `lastIndex`. */
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
        // A stray close with nothing matching open is dropped rather than unwinding a frame it never opened.
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
        // Click-to-reveal rather than deletion: the renderer keeps spoiler text out of the DOM until asked.
        out().push({ type: "spoiler", children: parseAniListHtml(sp[1], limit) });
        i += sp[0].length;
        continue;
      }
    }

    if (c === "&") {
      // The decoder is shared with the markdown parser so descriptions and bios never disagree about `&amp;`.
      const ent = at(ENTITY_RE, src, i);
      if (ent) {
        const decoded = decodeEntity(ent[1]);
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
  // Anything still open keeps its children: an unbalanced description loses its emphasis, not its words.
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
