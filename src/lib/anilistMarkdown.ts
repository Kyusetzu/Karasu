/** AniList-flavoured markdown parsed to a tree of plain data whose node types cannot carry markup. */

import { ENTITY_RE, decodeEntity } from "./htmlEntities";

/** Inline content. No member carries markup — only text and structure. */
export type MdInline =
  | { type: "text"; text: string }
  | { type: "strong"; children: MdInline[] }
  | { type: "em"; children: MdInline[] }
  | { type: "strike"; children: MdInline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: MdInline[] }
  | { type: "mention"; name: string }
  | { type: "spoiler"; children: MdInline[] }
  /** A bare `<a>` or a link `safeHref` refused: accent-coloured as on the site, never a target or href. */
  | { type: "accent"; children: MdInline[] }
  /** `~~~x~~~` inside a line, centred as on anilist.co rather than read as `~~`+`~` by the strike rule. */
  | { type: "centered"; children: MdInline[] }
  | {
      type: "chip";
      kind: "image" | "video";
      host: string;
      href: string;
      /** The author's declared width, if they gave one. See `ChipWidth`. */
      width?: ChipWidth;
      /** Render as a chip and make no request; only ever set on an image, see `capExcessImages`. */
      capped?: true;
    }
  | { type: "br" };

/** The declared `img###(url)` width, in pixels or a percentage, clamped so no consumer re-validates it. */
export interface ChipWidth {
  value: number;
  unit: "px" | "%";
}

/** Beyond this a declared pixel width is a mistake or an attack, not a layout. */
const MAX_IMAGE_PX = 2000;

/** `undefined` for no usable size; a percentage over 100 is clamped, the author meant as wide as possible. */
export function parseImageWidth(token: string | undefined): ChipWidth | undefined {
  if (!token) return undefined;
  const percent = token.endsWith("%");
  const value = Number.parseInt(percent ? token.slice(0, -1) : token, 10);
  if (!Number.isFinite(value) || value < 1) return undefined;
  return percent
    ? { value: Math.min(value, 100), unit: "%" }
    : { value: Math.min(value, MAX_IMAGE_PX), unit: "px" };
}

/** Block content. `center` and `spoiler` are the two nesting containers. */
export type MdNode =
  | { type: "p"; children: MdInline[] }
  | { type: "h"; level: 1 | 2 | 3 | 4 | 5 | 6; children: MdInline[] }
  | { type: "quote"; children: MdInline[] }
  | { type: "list"; ordered: boolean; items: MdInline[][] }
  | { type: "codeBlock"; text: string }
  | { type: "hr" }
  | { type: "center"; children: MdNode[] }
  /** A `~!…!~` whose opener and closer sit on different lines, the forum's usual shape. */
  | { type: "spoiler"; children: MdNode[] };

export interface ParsedMarkdown {
  nodes: MdNode[];
  /** The source was longer than the limit and the tail was dropped. */
  truncated: boolean;
}

/** The parse-time bound, applied first so an unclosed delimiter in a long line cannot go quadratic. */
const LIMIT = 8000;

/** `http(s)` or one leading `/`, a whitelist; keep `//host` refused, it names another host. */
function safeHref(raw: string): string | null {
  // Entities decode before the whitelist, so the check judges the bytes the browser would use.
  const href = raw.trim().replace(ENTITY_GLOBAL, (whole, name: string) => decodeEntity(name) ?? whole);
  if (/^https?:\/\/\S+$/i.test(href)) return href;
  if (/^\/(?!\/)[^\s]*$/.test(href)) return href;
  return null;
}

/** `ENTITY_RE`'s pattern with the global flag, for `replace` over a whole URL. */
const ENTITY_GLOBAL = new RegExp(ENTITY_RE.source, "g");

/** Reads the `(target)` at `i`, balanced parentheses and a title allowed; null when malformed. */
function readParenTarget(src: string, i: number): { url: string; end: number } | null {
  let j = i + 1;
  while (j < src.length && /\s/.test(src[j])) j += 1;
  const start = j;
  let depth = 0;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      if (depth === 0) break;
      depth -= 1;
    } else if (/\s/.test(ch)) break;
    j += 1;
  }
  const url = src.slice(start, j);
  if (!url) return null;
  let k = j;
  while (k < src.length && /[ \t]/.test(src[k])) k += 1;
  if (k < src.length && (src[k] === '"' || src[k] === "'")) {
    const close = src.indexOf(src[k], k + 1);
    if (close === -1) return null;
    k = close + 1;
    while (k < src.length && /[ \t]/.test(src[k])) k += 1;
  }
  if (src[k] !== ")") return null;
  return { url, end: k + 1 };
}

/** One attribute's value out of a tag's attribute string, quoted or bare. */
function attrOf(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/** The host, for a chip's label. Regex rather than `new URL`, which throws. */
function hostOf(href: string): string {
  return /^https?:\/\/([^/?#]+)/i.exec(href)?.[1] ?? "";
}

// --- Inline: sticky patterns matched at an index; slicing the remainder each time is quadratic.

const RE = {
  // `*?`, not `+?`: `~!!~` is an empty spoiler on anilist.co, not four characters of text.
  spoiler: /~!([\s\S]*?)!~/y,
  // Before `strike`, which would read two of the three tildes and leave the third to break what follows.
  centerInline: /~~~([\s\S]*?)~~~/y,
  strongStar: /\*\*(?!\s)([\s\S]+?)\*\*/y,
  strongScore: /__(?!\s)([\s\S]+?)__/y,
  strike: /~~(?!~)(?!\s)([\s\S]+?)~~/y,
  emStar: /\*(?!\s)([^*\n]+?)\*/y,
  emScore: /_(?!\s)([^_\n]+?)_/y,
  code: /`([^`\n]+)`/y,
  // Openers only, `readParenTarget` reads the `(url)`; the optional size is img33(u) or img200%(u).
  image: /img(\d+%?)?\(/iy,
  // One nested bracket level in the label, so `[![alt](img)](target)` is a link holding an image.
  mdImage: /!\[((?:[^\[\]]|\[[^\]]*\])*)\]\(/y,
  video: /(?:youtube|webm)\(/iy,
  link: /\[((?:[^\[\]]|\[[^\]]*\])*)\]\(/y,
  // `<img>` is an image, not a tag to drop; dropping it left a linked badge as an empty link.
  htmlImg: /<img\b([^>]*)>/iy,
  autolink: /https?:\/\/[^\s<>()[\]]+/y,
  mention: /@([A-Za-z0-9_]{2,20})\b/y,
  // `script` and `style` lose their contents too: theirs is code never meant to be read, not prose.
  dropWhole: /<\s*(script|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/iy,
  dropDangling: /<\s*(?:script|style)\b[\s\S]*$/iy,
  // Paired styling tags become the nodes they already mean; lazy, so a nested same-name tag flattens.
  htmlPair: /<(b|strong|i|em|s|del|strike)\b[^>]*>([\s\S]*?)<\/\1\s*>/iy,
  // `<a>` is a link or an accent node, decided in `pushHtmlAnchor`.
  htmlA: /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/iy,
  htmlTag: /<\/?[a-zA-Z][^>]*>|<!--[\s\S]*?-->|<![^>]*>/y,
  // An unclosed `<div` at the very end still has to be consumed, or it shows as a stray fragment.
  htmlDangling: /<\/?[a-zA-Z][^>]*$/y,
  brTag: /<br\s*\/?>/iy,
};

/** The pairs `htmlPair` keeps, mapped to the nodes they already mean. */
const TAG_NODE: Record<string, "strong" | "em" | "strike"> = {
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
  s: "strike",
  del: "strike",
  strike: "strike",
};

/** Matches `re` at `i`; advance by `m[0].length`, never `re.lastIndex`, which recursion corrupts. */
function at(re: RegExp, src: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(src);
}

/** True when `@` at `i` starts a mention rather than sitting inside an address. */
function mentionBoundary(src: string, i: number): boolean {
  if (i === 0) return true;
  return !/[A-Za-z0-9_.]/.test(src[i - 1]);
}

/** True when `_` at `i` may open emphasis: unlike `*`, CommonMark's `_` is inert inside a word. */
function underscoreBoundary(src: string, i: number): boolean {
  if (i === 0) return true;
  return !/[A-Za-z0-9]/.test(src[i - 1]);
}

function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  let buf = "";

  const flush = () => {
    if (buf) {
      out.push({ type: "text", text: buf });
      buf = "";
    }
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];

    // A newline is a break: real bios are line-oriented, and collapsing newlines turns each into one blob.
    if (c === "\n") {
      flush();
      out.push({ type: "br" });
      i += 1;
      continue;
    }

    if (c === "<") {
      const drop = at(RE.dropWhole, src, i) ?? at(RE.dropDangling, src, i);
      if (drop) {
        i += drop[0].length;
        continue;
      }
      const br = at(RE.brTag, src, i);
      if (br) {
        flush();
        out.push({ type: "br" });
        i += br[0].length;
        continue;
      }
      const htmlImg = at(RE.htmlImg, src, i);
      if (htmlImg) {
        flush();
        i += htmlImg[0].length;
        const srcAttr = attrOf(htmlImg[1], "src");
        // `width` is the size the `img220(u)` form declares; nothing else on the tag is ever read.
        if (srcAttr) {
          pushChip(out, "image", srcAttr, parseImageWidth(attrOf(htmlImg[1], "width") ?? undefined));
        }
        continue;
      }
      const pair = at(RE.htmlPair, src, i);
      if (pair) {
        flush();
        i += pair[0].length;
        out.push({ type: TAG_NODE[pair[1].toLowerCase()], children: parseInline(pair[2]) });
        continue;
      }
      const anchor = at(RE.htmlA, src, i);
      if (anchor) {
        flush();
        i += anchor[0].length;
        pushHtmlAnchor(out, anchor[1], parseInline(anchor[2]));
        continue;
      }
      // Every other tag, comment and doctype is dropped and its text reached by continuing the scan.
      const tag = at(RE.htmlTag, src, i) ?? at(RE.htmlDangling, src, i);
      if (tag) {
        i += tag[0].length;
        continue;
      }
    }

    if (c === "&") {
      // Decoded after parsing, in text position only, so `&lt;script&gt;` is characters rather than a tag.
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

    if (c === "~") {
      const sp = at(RE.spoiler, src, i);
      if (sp) {
        flush();
        i += sp[0].length;
        out.push({ type: "spoiler", children: parseInline(sp[1]) });
        continue;
      }
      const centre = at(RE.centerInline, src, i);
      if (centre) {
        flush();
        i += centre[0].length;
        out.push({ type: "centered", children: parseInline(centre[1]) });
        continue;
      }
      const st = at(RE.strike, src, i);
      if (st) {
        flush();
        i += st[0].length;
        out.push({ type: "strike", children: parseInline(st[1]) });
        continue;
      }
    }

    if (c === "*" || (c === "_" && underscoreBoundary(src, i))) {
      const strong = at(c === "*" ? RE.strongStar : RE.strongScore, src, i);
      if (strong) {
        flush();
        i += strong[0].length;
        out.push({ type: "strong", children: parseInline(strong[1]) });
        continue;
      }
      const em = at(c === "*" ? RE.emStar : RE.emScore, src, i);
      if (em) {
        flush();
        i += em[0].length;
        out.push({ type: "em", children: parseInline(em[1]) });
        continue;
      }
    }

    if (c === "`") {
      const code = at(RE.code, src, i);
      if (code) {
        flush();
        out.push({ type: "code", text: code[1] });
        i += code[0].length;
        continue;
      }
    }

    if (c === "i" || c === "I" || c === "y" || c === "Y" || c === "w" || c === "W") {
      const img = at(RE.image, src, i);
      // Each opener ends on its `(`, which is where the target reader starts.
      const imgTarget = img && readParenTarget(src, i + img[0].length - 1);
      if (img && imgTarget) {
        flush();
        // Group 1 is the declared size.
        pushChip(out, "image", imgTarget.url, parseImageWidth(img[1]));
        i = imgTarget.end;
        continue;
      }
      const vid = at(RE.video, src, i);
      const vidTarget = vid && readParenTarget(src, i + vid[0].length - 1);
      if (vid && vidTarget) {
        flush();
        pushChip(out, "video", vidTarget.url);
        i = vidTarget.end;
        continue;
      }
    }

    if (c === "!") {
      const img = at(RE.mdImage, src, i);
      const target = img && readParenTarget(src, i + img[0].length - 1);
      if (img && target) {
        flush();
        pushChip(out, "image", target.url);
        i = target.end;
        continue;
      }
    }

    if (c === "[") {
      const link = at(RE.link, src, i);
      const target = link && readParenTarget(src, i + link[0].length - 1);
      if (link && target) {
        const href = safeHref(target.url);
        flush();
        i = target.end;
        const children = parseInline(link[1]);
        // A rejected href is accent content rather than a link, as on the site; an empty label shows nothing.
        if (href) out.push({ type: "link", href, children });
        else out.push({ type: "accent", children });
        continue;
      }
    }

    if (c === "h") {
      const auto = at(RE.autolink, src, i);
      if (auto) {
        const href = safeHref(auto[0]);
        if (href) {
          flush();
          out.push({ type: "link", href, children: [{ type: "text", text: href }] });
          i += auto[0].length;
          continue;
        }
      }
    }

    if (c === "@" && mentionBoundary(src, i)) {
      const m = at(RE.mention, src, i);
      if (m) {
        flush();
        out.push({ type: "mention", name: m[1] });
        i += m[0].length;
        continue;
      }
    }

    // Nothing matched: one character of text, so the scan always advances.
    buf += c;
    i += 1;
  }

  flush();
  return out;
}

/** `<a>` with a usable href is a link over its children, otherwise an `accent` node with no target. */
function pushHtmlAnchor(out: MdInline[], attrs: string, children: MdInline[]) {
  const raw = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  const href = raw ? safeHref(raw[1] ?? raw[2] ?? raw[3] ?? "") : null;
  if (href) out.push({ type: "link", href, children });
  else out.push({ type: "accent", children });
}

function pushChip(
  out: MdInline[],
  kind: "image" | "video",
  raw: string,
  width?: ChipWidth,
) {
  const href = safeHref(raw);
  // An unusable URL leaves nothing behind, which is also what swallows `img(data:…)`.
  if (!href) return;
  // `width` is omitted rather than undefined, so the `Object.keys` safety test sees no meaningless key.
  out.push(
    width
      ? { type: "chip", kind, host: hostOf(href), href, width }
      : { type: "chip", kind, host: hostOf(href), href },
  );
}

// --- Blocks ---------------------------------------------------------------

const FENCE = /^\s*```/;
/** Closes a centred block: a line ending in `~~~`, whatever precedes the tildes being its last line. */
const CENTER_CLOSE = /^([\s\S]*?)~~~\s*$/;
/** Opens one; the trailing group is content on the fence's own line, which real bios write constantly. */
const CENTER_OPEN = /^\s*~~~(.*)$/;
/** The whole block on one line — the other common form, `~~~img28(url)~~~`. */
const CENTER_ONE_LINE = /^\s*~~~([\s\S]*?)~~~\s*$/;
/** The space after the hashes is optional: the site's browser renderer, not the API's `asHtml`, is the oracle. */
const HEADING = /^(#{1,6})(?!#)[ \t]*(\S.*)$/;
/** A heading written as HTML, alone on its line, the form centred bios use. */
const HTML_HEADING = /^\s*<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>\s*$/i;
/** `<hr>` alone on its line, drawn as the rule it is rather than dropped as one more unknown tag. */
const HTML_HR = /^\s*<hr\b[^>]*\/?>\s*$/i;
/** The HTML spelling of a centred block; group 1 is the whole open tag, group 2 the rest of the line. */
const CENTER_TAG_OPEN =
  /^\s*<(center\b[^>]*|(?:div|p)\b[^>]*\balign\s*=\s*["']?center["']?[^>]*)>([\s\S]*)$/i;

/** One HTML-centred block at `lines[start]`, or null; depth-counted so a nested `<div>` cannot close it early. */
function tryHtmlCenter(
  lines: string[],
  start: number,
): { body: string[]; next: number; oneLine: boolean } | null {
  const m = CENTER_TAG_OPEN.exec(lines[start]);
  if (!m) return null;
  const tag = /^[a-z]+/i.exec(m[1])![0].toLowerCase();
  const open = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const close = new RegExp(`<\\/\\s*${tag}\\s*>`, "gi");
  const count = (re: RegExp, s: string) => {
    re.lastIndex = 0;
    let n = 0;
    while (re.exec(s)) n += 1;
    return n;
  };

  const body: string[] = [];
  let depth = 1;
  let j = start;
  // Everything after the opening tag is the block's first content.
  let content = m[2];
  for (;;) {
    depth += count(open, content) - count(close, content);
    if (depth <= 0) {
      // Closed on this line: everything up to the last close tag belongs to the block.
      const cut = content.toLowerCase().lastIndexOf(`</${tag}`);
      const inner = cut === -1 ? content : content.slice(0, cut);
      if (inner.trim()) body.push(inner);
      return { body, next: j + 1, oneLine: j === start };
    }
    if (content.trim()) body.push(content);
    j += 1;
    if (j >= lines.length) return { body, next: j, oneLine: false };
    content = lines[j];
  }
}

/** A one-line centred HTML row: anilist.co runs no markdown block rule inside it, only the HTML forms. */
function parseHtmlInner(body: string[]): MdNode[] {
  const out: MdNode[] = [];
  for (const line of body) {
    const hh = HTML_HEADING.exec(line);
    if (hh) {
      out.push({
        type: "h",
        level: Number(hh[1]) as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(hh[2]),
      });
      continue;
    }
    if (HTML_HR.test(line)) {
      out.push({ type: "hr" });
      continue;
    }
    const nested = tryHtmlCenter([line], 0);
    if (nested) {
      out.push({ type: "center", children: parseHtmlInner(nested.body) });
      continue;
    }
    out.push({ type: "p", children: parseInline(line) });
  }
  return out;
}
const QUOTE = /^\s*>\s?(.*)$/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|(.*)\|?\s*$/;
const TABLE_RULE = /^[\s|:-]+$/;

/** Where the line's first unclosed `~!` begins, or null; `~!~` is an opener, as the inline rule reads it. */
function spoilerOpenAt(line: string): number | null {
  const open: number[] = [];
  let i = 0;
  while (i < line.length - 1) {
    if (line[i] === "~" && line[i + 1] === "!") {
      open.push(i);
      i += 2;
    } else if (line[i] === "!" && line[i + 1] === "~") {
      open.pop();
      i += 2;
    } else {
      i += 1;
    }
  }
  return open.length ? open[0] : null;
}

/** Where the first `!~` that no earlier `~!` on the same line opened sits, or null. */
function spoilerCloseAt(line: string): number | null {
  let depth = 0;
  let i = 0;
  while (i < line.length - 1) {
    if (line[i] === "~" && line[i + 1] === "!") {
      depth += 1;
      i += 2;
    } else if (line[i] === "!" && line[i + 1] === "~") {
      if (depth === 0) return i;
      depth -= 1;
      i += 2;
    } else {
      i += 1;
    }
  }
  return null;
}

/** The block spoiler opening on line `i`: its opener's column and the first closer below, or null. */
function blockSpoilerAt(
  lines: string[],
  i: number,
): { open: number; j: number; close: number } | null {
  const open = spoilerOpenAt(lines[i]);
  if (open === null) return null;
  for (let j = i + 1; j < lines.length; j += 1) {
    const close = spoilerCloseAt(lines[j]);
    if (close !== null) return { open, j, close };
  }
  return null;
}

/** Groups lines into blocks; every branch consumes at least one line, so the loop always terminates. */
function parseBlocks(input: string[]): MdNode[] {
  // A copy: a block spoiler's closing line is split and its tail written back as the next line to read.
  const lines = input.slice();
  const out: MdNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // A spoiler spanning lines, before the fence branch on purpose: on the site one opened above a fence takes it.
    const spoiler = blockSpoilerAt(lines, i);
    if (spoiler) {
      const { open, j, close } = spoiler;
      const before = line.slice(0, open);
      if (before.trim()) out.push(...parseBlocks([before]));
      const body = [line.slice(open + 2), ...lines.slice(i + 1, j), lines[j].slice(0, close)];
      out.push({ type: "spoiler", children: parseBlocks(body) });
      const after = lines[j].slice(close + 2);
      lines[j] = after;
      i = after.trim() ? j : j + 1;
      continue;
    }

    // Fence contents are kept verbatim, so a `~!spoiler!~` inside stays a code sample about the syntax.
    if (FENCE.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i += 1; // closing fence
      out.push({ type: "codeBlock", text: body.join("\n") });
      continue;
    }

    // Centred blocks; single line first, or `~~~x~~~` reads as an opener whose content ends in `~~~`.
    const oneLine = CENTER_ONE_LINE.exec(line);
    if (oneLine) {
      out.push({ type: "center", children: parseBlocks([oneLine[1]]) });
      i += 1;
      continue;
    }

    // The HTML spelling, same node: whole bios are one-line `<div align="center">` rows.
    const htmlCenter = tryHtmlCenter(lines, i);
    if (htmlCenter) {
      out.push({
        type: "center",
        children: htmlCenter.oneLine
          ? parseHtmlInner(htmlCenter.body)
          : parseBlocks(htmlCenter.body),
      });
      i = htmlCenter.next;
      continue;
    }

    const opener = CENTER_OPEN.exec(line);
    if (opener) {
      // Anything after the fence on the opening line is the block's first line.
      const body: string[] = opener[1].trim() ? [opener[1]] : [];
      i += 1;
      while (i < lines.length) {
        const close = CENTER_CLOSE.exec(lines[i]);
        i += 1;
        if (close) {
          // Content on the closing line belongs to the block; a bare `~~~` contributes nothing.
          if (close[1].trim()) body.push(close[1]);
          break;
        }
        body.push(lines[i - 1]);
      }
      out.push({ type: "center", children: parseBlocks(body) });
      continue;
    }

    if (HR.test(line) || HTML_HR.test(line)) {
      out.push({ type: "hr" });
      i += 1;
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      out.push({
        type: "h",
        level: h[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(h[2]),
      });
      i += 1;
      continue;
    }

    const hh = HTML_HEADING.exec(line);
    if (hh) {
      out.push({
        type: "h",
        level: Number(hh[1]) as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(hh[2]),
      });
      i += 1;
      continue;
    }

    // Consecutive `>` lines are one quote, not one per line.
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(QUOTE.exec(lines[i])![1]);
        i += 1;
      }
      out.push({ type: "quote", children: parseInline(body.join("\n")) });
      continue;
    }

    // One level only, a nested item joins the flat list; nesting is where a hand-written parser gets expensive.
    if (UL.test(line) || OL.test(line)) {
      const ordered = OL.test(line);
      const items: MdInline[][] = [];
      while (i < lines.length) {
        const m = (ordered ? OL : UL).exec(lines[i]) ?? (ordered ? UL : OL).exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[1]));
        i += 1;
      }
      out.push({ type: "list", ordered, items });
      continue;
    }

    // Tables become one paragraph per row of cell text; dropping the row would lose the content.
    if (TABLE_ROW.test(line) && line.includes("|")) {
      while (i < lines.length && TABLE_ROW.test(lines[i]) && lines[i].includes("|")) {
        const row = lines[i];
        i += 1;
        if (TABLE_RULE.test(row)) continue; // the |---|---| separator
        const cells = row
          .replace(/^\s*\|/, "")
          .replace(/\|\s*$/, "")
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean);
        if (cells.length) out.push({ type: "p", children: parseInline(cells.join(" · ")) });
      }
      continue;
    }

    // Paragraph up to a blank line or another block, a block spoiler included, or a `~!` on line two is swallowed.
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !startsBlock(lines[i]) &&
      (body.length === 0 || blockSpoilerAt(lines, i) === null)
    ) {
      body.push(lines[i].replace(/\s+$/, ""));
      i += 1;
    }
    // `startsBlock` on the first line would spin; the branches above rule it out, so `body` is never empty.
    if (!body.length) {
      body.push(lines[i].replace(/\s+$/, ""));
      i += 1;
    }
    out.push({ type: "p", children: parseInline(body.join("\n")) });
  }

  return out;
}

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    CENTER_OPEN.test(line) ||
    CENTER_TAG_OPEN.test(line) ||
    HR.test(line) ||
    HTML_HR.test(line) ||
    HEADING.test(line) ||
    HTML_HEADING.test(line) ||
    QUOTE.test(line) ||
    UL.test(line) ||
    OL.test(line)
  );
}

/** How many images one document may fetch; each is a Rust request, and a bio must not set the fan-out. */
export const MAX_INLINE_IMAGES = 24;

/** Marks image chips past `MAX_INLINE_IMAGES`; a tree walk, since the inline parser runs per block. */
function capExcessImages(nodes: MdNode[]): void {
  let seen = 0;
  const inline = (list: MdInline[]) => {
    for (const n of list) {
      switch (n.type) {
        case "chip":
          if (n.kind === "image" && ++seen > MAX_INLINE_IMAGES) n.capped = true;
          break;
        case "strong":
        case "em":
        case "strike":
        case "link":
        case "spoiler":
        // `accent` too, or an image inside a bare `<a>` would escape the cap this walk exists to enforce.
        case "accent":
        case "centered":
          inline(n.children);
          break;
      }
    }
  };
  const block = (list: MdNode[]) => {
    for (const n of list) {
      switch (n.type) {
        case "p":
        case "h":
        case "quote":
          inline(n.children);
          break;
        case "list":
          for (const item of n.items) inline(item);
          break;
        case "center":
        case "spoiler":
          block(n.children);
          break;
      }
    }
  };
  block(nodes);
}

/** Parses AniList markdown; never throws, and never returns a node carrying markup. */
export function parseAniListMarkdown(
  src: string,
  { limit = LIMIT }: { limit?: number } = {},
): ParsedMarkdown {
  const text = typeof src === "string" ? src : "";
  const truncated = text.length > limit;
  // Before anything else: this is what bounds the parse, not just the output.
  const bounded = truncated ? text.slice(0, limit) : text;
  const nodes = parseBlocks(bounded.replace(/\r\n?/g, "\n").split("\n"));
  capExcessImages(nodes);
  return { nodes, truncated };
}

/** One line of plain text through the same parser; a spoiler becomes the placeholder, never its text. */
export function renderPlain(src: string, max = 200, spoiler = "[…]"): string {
  const { nodes } = parseAniListMarkdown(src);
  const parts: string[] = [];

  const inline = (kids: MdInline[]) => {
    for (const n of kids) {
      switch (n.type) {
        case "text":
          parts.push(n.text);
          break;
        case "code":
          parts.push(n.text);
          break;
        case "mention":
          parts.push(`@${n.name}`);
          break;
        case "br":
          parts.push(" ");
          break;
        case "chip":
          break;
        case "spoiler":
          parts.push(spoiler);
          break;
        case "strong":
        case "em":
        case "strike":
        case "link":
        // Without this, `18<a>&#8593;</a>` previews as "18".
        case "accent":
        case "centered":
          inline(n.children);
          break;
      }
    }
  };

  const block = (kids: MdNode[]) => {
    for (const n of kids) {
      switch (n.type) {
        case "p":
        case "h":
        case "quote":
          inline(n.children);
          parts.push(" ");
          break;
        case "list":
          for (const item of n.items) {
            inline(item);
            parts.push(" ");
          }
          break;
        case "codeBlock":
          parts.push(n.text, " ");
          break;
        case "center":
          block(n.children);
          break;
        case "spoiler":
          parts.push(spoiler, " ");
          break;
        case "hr":
          break;
      }
    }
  };

  block(nodes);
  const flat = parts.join("").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
