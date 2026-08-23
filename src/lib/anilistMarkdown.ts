/**
 * AniList-flavoured markdown, parsed to a tree of plain data.
 *
 * Bios, thread bodies, comments and text activities are all written in this
 * dialect: markdown-it plus AniList's own additions, authored by strangers, and
 * rendered inside a WebView whose `csp` is `null`.
 *
 * **Why a tree and not sanitized HTML.** `lib/description.ts` takes the other
 * road for media descriptions, and its own comment records that its previous
 * version was a live path from a description to script execution here. It
 * survives by allowing five tags with no attributes, which is far less
 * structure than a bio needs. The deciding argument is testability: this repo
 * has no jsdom and no `@testing-library`, so a sanitizer's contract — "this
 * HTML string is safe" — cannot be asserted without a DOM, while a tree's — "no
 * node can carry executable content" — is a walk over plain objects. The union
 * below has no `html` or `raw` member, so there is nothing for a renderer to
 * pass through even by mistake.
 *
 * **What it deliberately gets wrong.** A visible minority of AniList profiles
 * are HTML art: absolutely-positioned `div`s, inline CSS, background images. In
 * a sample of 44 real bios, 24 contained raw tags. Those cannot survive here,
 * so tags are *dropped and their text kept* — an art bio degrades to its prose.
 * Escaping the tags into visible `<div style=…>` was the alternative and it is
 * worse: a wall of markup reads as a bug in Karasu, where a plain bio does not.
 *
 * **Images and embeds are parsed into `chip` nodes either way** — what the
 * renderer does with one is its business, not the parser's. `RichText` now
 * fetches an image through Rust and inlines it as a `data:` URI, falling back to
 * a chip when that fails; a video is always a chip.
 *
 * The measurement behind that split is worth keeping here: across 89 bios
 * holding 350 images, **6 were on `*.anilist.co`** and the rest were imgur,
 * tumblr, pinimg, catbox and discord. That is why `img-src` was never widened —
 * an allowlist over that tail hands an unbounded set of third parties the user's
 * IP — and why the images arrive through a proxy instead. See
 * `components/RichText.tsx` and `commands/images.rs`.
 *
 * Grounded in real data rather than the docs. Of those 44 bios: 36 relied on
 * single newlines (hence `br`, see `LIMIT`), 25 used `~~~centered~~~`, 24 used
 * AniList's `img120(url)` form — including percentages like `img200%(url)` —
 * and exactly one used markdown's `![](…)`. One carried
 * `[](jsonN4IgDglg…)`, which is AniList's own hidden profile-layout blob; the
 * href allowlist drops it, which is the whole reason the allowlist is a
 * whitelist and not a `javascript:` blacklist.
 */

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
  | {
      type: "chip";
      kind: "image" | "video";
      host: string;
      href: string;
      /** The author's declared width, if they gave one. See `ChipWidth`. */
      width?: ChipWidth;
      /**
       * Render as a chip and make no request. See `capExcessImages`.
       *
       * Only ever set on `kind: "image"`; a video is never fetched anyway.
       */
      capped?: true;
    }
  | { type: "br" };

/**
 * The width an author asked for, parsed and clamped.
 *
 * AniList documents `img###(url)` as "the width in **pixels**, such as `420`"
 * (thread 6125, "Anilist-Flavored Markdown"), which settles a reading that
 * could otherwise only be guessed at: `img33(u)` is a 33px icon, not a third of
 * the column. The `%` spelling is not in that documentation but is accepted by
 * the same syntax and appears in real bios, so it is carried through as a
 * percentage rather than silently read as pixels.
 *
 * This was being **discarded**: the size group was non-capturing, so `img33(u)`
 * and `img200%(u)` rendered identically to `img(u)`. This module's own header
 * records that 24 of 44 sampled bios use this form, so it was the common case
 * that was being ignored, not an edge.
 *
 * Clamped here rather than at the render site so that no consumer can be handed
 * a number it has to re-validate — a width is either absent or usable.
 */
export interface ChipWidth {
  value: number;
  unit: "px" | "%";
}

/** Beyond this a declared pixel width is a mistake or an attack, not a layout. */
const MAX_IMAGE_PX = 2000;

/**
 * `undefined` for no declared size, and for any size that is not a width.
 *
 * A percentage above 100 is clamped rather than dropped: the author did mean
 * "as wide as possible", and `max-w-full` would bound it anyway.
 */
export function parseImageWidth(token: string | undefined): ChipWidth | undefined {
  if (!token) return undefined;
  const percent = token.endsWith("%");
  const value = Number.parseInt(percent ? token.slice(0, -1) : token, 10);
  if (!Number.isFinite(value) || value < 1) return undefined;
  return percent
    ? { value: Math.min(value, 100), unit: "%" }
    : { value: Math.min(value, MAX_IMAGE_PX), unit: "px" };
}

/** Block content. `center` is the only nesting container. */
export type MdNode =
  | { type: "p"; children: MdInline[] }
  | { type: "h"; level: 1 | 2 | 3 | 4 | 5 | 6; children: MdInline[] }
  | { type: "quote"; children: MdInline[] }
  | { type: "list"; ordered: boolean; items: MdInline[][] }
  | { type: "codeBlock"; text: string }
  | { type: "hr" }
  | { type: "center"; children: MdNode[] };

export interface ParsedMarkdown {
  nodes: MdNode[];
  /** The source was longer than the limit and the tail was dropped. */
  truncated: boolean;
}

/**
 * The parse-time bound, not a cosmetic cap.
 *
 * Inline scanning tries a handful of lazy patterns at each position, so an
 * unclosed delimiter in a very long single line is quadratic. Truncating first
 * turns that worst case into a fixed ceiling, which is why the limit is applied
 * before any other work. The longest bio in the sample was 4,487 characters, so
 * this is an outlier bound rather than something a normal profile meets.
 */
const LIMIT = 8000;

/** `http`/`https` for the world, a leading `/` for our own routes. Anything else
 *  — `javascript:`, `data:`, `vbscript:`, and AniList's `json…` layout blob —
 *  is not a link, and the node is never created.
 *
 *  `//` is excluded from the "our own routes" arm on purpose: a
 *  protocol-relative URL like `//evil.example/x` starts with a slash but names
 *  another *host*, and the internal branch hands its href straight to the
 *  router. The HashRouter happens to defang it today by prefixing `#`; the
 *  parser does not get to rely on which router the renderer mounts. */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^https?:\/\/\S+$/i.test(href)) return href;
  if (/^\/(?!\/)[^\s]*$/.test(href)) return href;
  return null;
}

/** The host, for a chip's label. Regex rather than `new URL`, which throws. */
function hostOf(href: string): string {
  return /^https?:\/\/([^/?#]+)/i.exec(href)?.[1] ?? "";
}

// --- Inline ---------------------------------------------------------------
// Sticky patterns, matched at an explicit index. Slicing the remainder at each
// position instead would make the scan itself quadratic before any backtracking.

const RE = {
  spoiler: /~!([\s\S]+?)!~/y,
  strongStar: /\*\*(?!\s)([\s\S]+?)\*\*/y,
  strongScore: /__(?!\s)([\s\S]+?)__/y,
  strike: /~~(?!~)(?!\s)([\s\S]+?)~~/y,
  emStar: /\*(?!\s)([^*\n]+?)\*/y,
  emScore: /_(?!\s)([^_\n]+?)_/y,
  code: /`([^`\n]+)`/y,
  // AniList's own image form, with an optional size: img(u) img33(u) img200%(u)
  image: /img(\d+%?)?\(\s*([^)\s]+)\s*\)/iy,
  mdImage: /!\[[^\]]*\]\(\s*([^)\s]+)\s*\)/y,
  video: /(?:youtube|webm)\(\s*([^)\s]+)\s*\)/iy,
  link: /\[([^\]]*)\]\(\s*([^)\s]+)\s*\)/y,
  autolink: /https?:\/\/[^\s<>()[\]]+/y,
  mention: /@([A-Za-z0-9_]{2,20})\b/y,
  // `script` and `style` lose their *contents* too, not just their tags. Every
  // other element's text is prose worth keeping; theirs is code that was never
  // meant to be read, and showing it produced `bold bitalert(1)` on a real bio.
  dropWhole: /<\s*(script|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/iy,
  dropDangling: /<\s*(?:script|style)\b[\s\S]*$/iy,
  htmlTag: /<\/?[a-zA-Z][^>]*>|<!--[\s\S]*?-->|<![^>]*>/y,
  // An unclosed `<div` at the very end still has to be consumed, or the scanner
  // emits it as literal text and the art bio shows a stray fragment.
  htmlDangling: /<\/?[a-zA-Z][^>]*$/y,
  brTag: /<br\s*\/?>/iy,
};

/**
 * Matches `re` at exactly `i`.
 *
 * Callers must advance by `i + m[0].length` and **never** by `re.lastIndex`.
 * These patterns are module-level objects and `parseInline` recurses into its
 * own matches, so an inner call mutates the very `lastIndex` an outer one was
 * about to read — and a failed sticky `exec` resets it to 0. Reading it after
 * recursing sent `i` backwards on input as ordinary as `~!~!~!`, which spun
 * until the heap gave out. The match's own length cannot be corrupted.
 */
function at(re: RegExp, src: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(src);
}

/** True when `@` at `i` starts a mention rather than sitting inside an address. */
function mentionBoundary(src: string, i: number): boolean {
  if (i === 0) return true;
  return !/[A-Za-z0-9_.]/.test(src[i - 1]);
}

/**
 * True when `_` at `i` may open emphasis.
 *
 * CommonMark — which markdown-it, and therefore AniList, follows — allows
 * intraword emphasis for `*` but not for `_`, so `a*b*c` is `a<em>b</em>c`
 * while `a_b_c` is literal. That asymmetry is not pedantry here: nine of the
 * forty-four sampled bios used `__bold__`, and underscores are ordinary inside
 * usernames, file names and URLs. Without this, `snake_case_name` renders half
 * italic.
 */
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

    // Newline is a break: 36 of 44 sampled bios are line-oriented, and
    // collapsing newlines the way CommonMark does turns each into one blob.
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
      // Every other tag, comment and doctype: gone, contents kept. The text
      // between tags is reached by simply continuing the scan.
      const tag = at(RE.htmlTag, src, i) ?? at(RE.htmlDangling, src, i);
      if (tag) {
        i += tag[0].length;
        continue;
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
      if (img) {
        flush();
        // Group 1 is the declared size, group 2 the URL — the size group used
        // to be non-capturing, which is why the URL was `img[1]`.
        pushChip(out, "image", img[2], parseImageWidth(img[1]));
        i += img[0].length;
        continue;
      }
      const vid = at(RE.video, src, i);
      if (vid) {
        flush();
        pushChip(out, "video", vid[1]);
        i += vid[0].length;
        continue;
      }
    }

    if (c === "!") {
      const img = at(RE.mdImage, src, i);
      if (img) {
        flush();
        pushChip(out, "image", img[1]);
        i += img[0].length;
        continue;
      }
    }

    if (c === "[") {
      const link = at(RE.link, src, i);
      if (link) {
        const href = safeHref(link[2]);
        flush();
        i += link[0].length;
        const children = parseInline(link[1]);
        // A rejected href is not a link. Its label still is content — which is
        // how AniList's `[](json…)` layout blob vanishes: empty label, no node.
        if (href) out.push({ type: "link", href, children });
        else out.push(...children);
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

function pushChip(
  out: MdInline[],
  kind: "image" | "video",
  raw: string,
  width?: ChipWidth,
) {
  const href = safeHref(raw);
  // An unusable URL leaves nothing behind — better than a chip that goes
  // nowhere. This is also what swallows `img(data:…)`.
  if (!href) return;
  // `width` is omitted rather than set to undefined: the safety test in
  // `anilistMarkdown.test.ts` walks `Object.keys`, and a key that is always
  // present but usually meaningless is noise in exactly the check that exists
  // to make an unexpected field visible.
  out.push(
    width
      ? { type: "chip", kind, host: hostOf(href), href, width }
      : { type: "chip", kind, host: hostOf(href), href },
  );
}

// --- Blocks ---------------------------------------------------------------

const FENCE = /^\s*```/;
/**
 * Closes a centred block: a line *ending* in three tildes, with whatever
 * precedes them being the block's last line. Real bios end this way —
 * `img220(url)~~~` with no newline before the fence — and requiring a bare
 * `~~~` line left the tildes on screen there, mirroring the opener's lesson.
 */
const CENTER_CLOSE = /^([\s\S]*?)~~~\s*$/;
/**
 * Opens one. The trailing group is content written on the *same line* as the
 * fence, which real bios do constantly — `~~~ tam | she/her | arg` was the form
 * that exposed this. Requiring a bare `~~~` line left the tildes on screen.
 */
const CENTER_OPEN = /^\s*~~~(.*)$/;
/** The whole block on one line — the other common form, `~~~img28(url)~~~`. */
const CENTER_ONE_LINE = /^\s*~~~([\s\S]*?)~~~\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|(.*)\|?\s*$/;
const TABLE_RULE = /^[\s|:-]+$/;

/**
 * Groups lines into blocks. Every branch consumes at least one line, so the
 * loop terminates on any input.
 */
function parseBlocks(lines: string[]): MdNode[] {
  const out: MdNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // ``` fence — contents kept verbatim, never parsed. A `~!spoiler!~` inside
    // a fence has to stay literal or a code sample about the syntax breaks.
    if (FENCE.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i += 1; // closing fence
      out.push({ type: "codeBlock", text: body.join("\n") });
      continue;
    }

    // Centred blocks — 25 of 44 sampled bios have one. Single line first, so
    // `~~~x~~~` is not read as an opener whose content happens to end in `~~~`.
    const oneLine = CENTER_ONE_LINE.exec(line);
    if (oneLine) {
      out.push({ type: "center", children: parseBlocks([oneLine[1]]) });
      i += 1;
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
          // Content on the closing line belongs to the block; a bare `~~~`
          // has a whitespace-only prefix and contributes nothing.
          if (close[1].trim()) body.push(close[1]);
          break;
        }
        body.push(lines[i - 1]);
      }
      out.push({ type: "center", children: parseBlocks(body) });
      continue;
    }

    if (HR.test(line)) {
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

    // One level only. A nested item joins the flat list rather than starting a
    // sub-list: nesting is where a hand-written block parser gets expensive,
    // and a bio's shopping list does not need it.
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

    // Tables become one paragraph per row of cell text. Rendering a real table
    // is out of scope, and dropping the row would lose the content.
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

    // Paragraph: every line up to a blank one or the start of another block.
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      body.push(lines[i].replace(/\s+$/, ""));
      i += 1;
    }
    // `startsBlock` on the very first line would spin; the branches above have
    // already ruled that out, so `body` is never empty here.
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
    HR.test(line) ||
    HEADING.test(line) ||
    QUOTE.test(line) ||
    UL.test(line) ||
    OL.test(line)
  );
}

/**
 * How many images one document may fetch.
 *
 * Every inlined image is a separate bounded request made by Rust
 * (`commands/images.rs`), issued from an effect the moment the node mounts —
 * so the count is decided by whoever wrote the bio, and they are all in flight
 * at once. Nothing stops a crafted profile reaching several hundred, and that
 * is a request fan-out a single page view should not be able to ask for.
 *
 * Past the cap the chip is still rendered, so nothing disappears — it is the
 * same fallback a refused host or an oversized file already produces.
 */
export const MAX_INLINE_IMAGES = 24;

/**
 * Marks image chips past `MAX_INLINE_IMAGES`, in document order.
 *
 * A walk over the finished tree rather than a counter threaded through the
 * parser: the cap is a property of the whole document, and the inline parser
 * runs per block with no idea what came before it.
 */
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
          block(n.children);
          break;
      }
    }
  };
  block(nodes);
}

/**
 * Parses AniList markdown. Never throws, and never returns a node carrying
 * markup — see the union above.
 */
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

/**
 * The same source as one line of plain text — for a preview, a tooltip or a
 * length check. Shares the parser so the two can never disagree about what
 * counts as content.
 */
export function renderPlain(src: string, max = 200): string {
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
        case "strong":
        case "em":
        case "strike":
        case "link":
        case "spoiler":
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
        case "hr":
          break;
      }
    }
  };

  block(nodes);
  const flat = parts.join("").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
