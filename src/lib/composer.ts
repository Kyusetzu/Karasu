/** Why a post is refused, as a key rather than a sentence so `i18nKeys.test.ts` can see the string. */
export type PostRejection = "empty" | "tooLong";

export interface PostValidation {
  ok: boolean;
  reason?: PostRejection;
  /** What to actually send: trimmed, with runs of blank lines collapsed. */
  text: string;
}

/** Karasu's own bound, AniList documents none; without one a pasted novel fails at the API, not in the box. */
export const POST_MAX = 4000;

export function validatePost(raw: string): PostValidation {
  // Three or more newlines become two, since AniList renders every newline as a break in the feed.
  const text = raw.trim().replace(/\n{3,}/g, "\n\n");
  if (!text) return { ok: false, reason: "empty", text };
  // Counted on the trimmed text, so trailing whitespace cannot push a valid post over the edge.
  if (text.length > POST_MAX) return { ok: false, reason: "tooLong", text };
  return { ok: true, text };
}

/** Characters left for the counter, negative once over so the caller need not repeat the comparison. */
export function charsLeft(raw: string): number {
  return POST_MAX - raw.trim().length;
}

/** Why a thread is refused; a categoryless one lands nowhere anyone browses, and the title bound is Karasu's. */
export type ThreadRejection = "titleEmpty" | "titleTooLong" | PostRejection | "noCategory";

export const TITLE_MAX = 120;

export interface ThreadValidation {
  ok: boolean;
  reason?: ThreadRejection;
  title: string;
  body: string;
}

export function validateThread(
  rawTitle: string,
  rawBody: string,
  categories: number[],
): ThreadValidation {
  const title = rawTitle.trim().replace(/\s+/g, " ");
  const bodyCheck = validatePost(rawBody);
  const out = { title, body: bodyCheck.text };
  if (!title) return { ok: false, reason: "titleEmpty", ...out };
  if (title.length > TITLE_MAX) return { ok: false, reason: "titleTooLong", ...out };
  if (!bodyCheck.ok) return { ok: false, reason: bodyCheck.reason, ...out };
  if (categories.length === 0) return { ok: false, reason: "noCategory", ...out };
  return { ok: true, ...out };
}

/** Why a review is refused; every bound is AniList's own, checked here so the box can explain it. */
export type ReviewRejection =
  | "summaryTooShort"
  | "summaryTooLong"
  | "bodyTooShort"
  | "scoreOut";

export const REVIEW_SUMMARY_MIN = 20;
export const REVIEW_SUMMARY_MAX = 120;
export const REVIEW_BODY_MIN = 2200;

export interface ReviewValidation {
  ok: boolean;
  reason?: ReviewRejection;
  summary: string;
  body: string;
}

export function validateReview(
  rawSummary: string,
  rawBody: string,
  score: number,
): ReviewValidation {
  const summary = rawSummary.trim().replace(/\s+/g, " ");
  const body = rawBody.trim().replace(/\n{3,}/g, "\n\n");
  const out = { summary, body };
  if (summary.length < REVIEW_SUMMARY_MIN)
    return { ok: false, reason: "summaryTooShort", ...out };
  if (summary.length > REVIEW_SUMMARY_MAX)
    return { ok: false, reason: "summaryTooLong", ...out };
  if (body.length < REVIEW_BODY_MIN) return { ok: false, reason: "bodyTooShort", ...out };
  if (!Number.isInteger(score) || score < 0 || score > 100)
    return { ok: false, reason: "scoreOut", ...out };
  return { ok: true, ...out };
}

// --- Editing: the toolbar's arithmetic as pure functions over (text, start, end), shared and node-tested.

/** The text after an edit, and the selection to leave in it. */
export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

/** The inline marks as marker pairs; italic is `*x*`, never `_x_`, since `_` is inert inside a word. */
export const INLINE_MARKS = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  strike: ["~~", "~~"],
  spoiler: ["~!", "!~"],
  code: ["`", "`"],
} as const satisfies Record<string, readonly [string, string]>;

const order = (start: number, end: number): [number, number] =>
  start <= end ? [start, end] : [end, start];

/** The selection minus its outer whitespace, because the parser refuses `** x**`. */
function trimmed(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s])) s += 1;
  while (e > s && /\s/.test(text[e - 1])) e -= 1;
  return [s, e];
}

/** Wraps the selection in the markers, or unwraps it when they already sit just outside or inside it. */
export function wrapSelection(
  text: string,
  start: number,
  end: number,
  before: string,
  after: string,
): TextEdit {
  const [s0, e0] = order(start, end);
  const [s, e] = trimmed(text, s0, e0);
  const sel = text.slice(s, e);
  // Repeated-character markers are judged by the run either side, so `**word**` is not italic to switch off.
  const run = before.length > 0 && after === before && [...before].every((ch) => ch === before[0])
    ? before[0]
    : null;
  if (run) {
    const n = before.length;
    let rb = 0;
    while (s - 1 - rb >= 0 && text[s - 1 - rb] === run) rb += 1;
    let ra = 0;
    while (e + ra < text.length && text[e + ra] === run) ra += 1;
    const present = rb >= n && ra >= n && (n > 1 || (rb % 2 === 1 && ra % 2 === 1));
    if (present) {
      return {
        text: text.slice(0, s - n) + sel + text.slice(e + n),
        start: s - n,
        end: s - n + sel.length,
      };
    }
  } else if (
    s >= before.length &&
    text.slice(s - before.length, s) === before &&
    text.slice(e, e + after.length) === after
  ) {
    return {
      text: text.slice(0, s - before.length) + sel + text.slice(e + after.length),
      start: s - before.length,
      end: s - before.length + sel.length,
    };
  }
  // Markers just inside: `|**sel**|` → toggle off.
  if (sel.length >= before.length + after.length && sel.startsWith(before) && sel.endsWith(after)) {
    const inner = sel.slice(before.length, sel.length - after.length);
    return { text: text.slice(0, s) + inner + text.slice(e), start: s, end: s + inner.length };
  }
  if (!sel) {
    const out = text.slice(0, s0) + before + after + text.slice(s0);
    return { text: out, start: s0 + before.length, end: s0 + before.length };
  }
  return {
    text: text.slice(0, s) + before + sel + after + text.slice(e),
    start: s + before.length,
    end: s + before.length + sel.length,
  };
}

export type LinePrefix = "quote" | "bullet" | "numbered" | { heading: 1 | 2 | 3 | 4 | 5 | 6 };

/** The lines the selection touches, whole: [lineStart, lineEnd). */
function lineSpan(text: string, start: number, end: number): [number, number] {
  const [s, e] = order(start, end);
  const lineStart = text.lastIndexOf("\n", s - 1) + 1;
  // A selection that ends right after a newline does not include the next line.
  const probe = e > s && text[e - 1] === "\n" ? e - 1 : e;
  const nl = text.indexOf("\n", probe);
  return [lineStart, nl === -1 ? text.length : nl];
}

const HEADING_MARK = /^#{1,6}\s+/;
const QUOTE_MARK = /^>\s?/;
const BULLET_MARK = /^[-*+]\s+/;
const NUMBER_MARK = /^\d+\.\s+/;

/** Prefixes every line the selection touches, or strips the prefix when every line already carries it. */
export function prefixLines(text: string, start: number, end: number, prefix: LinePrefix): TextEdit {
  const [ls, le] = lineSpan(text, start, end);
  const lines = text.slice(ls, le).split("\n");
  let out: string[];
  if (prefix === "quote") {
    out = lines.every((l) => QUOTE_MARK.test(l))
      ? lines.map((l) => l.replace(QUOTE_MARK, ""))
      : lines.map((l) => (QUOTE_MARK.test(l) ? l : `> ${l}`));
  } else if (prefix === "bullet") {
    out = lines.every((l) => BULLET_MARK.test(l))
      ? lines.map((l) => l.replace(BULLET_MARK, ""))
      : lines.map((l) => (BULLET_MARK.test(l) ? l : `- ${l}`));
  } else if (prefix === "numbered") {
    out = lines.every((l) => NUMBER_MARK.test(l))
      ? lines.map((l) => l.replace(NUMBER_MARK, ""))
      : lines.map((l, i) => `${i + 1}. ${l.replace(NUMBER_MARK, "")}`);
  } else {
    const mark = "#".repeat(prefix.heading) + " ";
    out = lines.every((l) => l.startsWith(mark))
      ? lines.map((l) => l.slice(mark.length))
      : lines.map((l) => mark + l.replace(HEADING_MARK, ""));
  }
  const block = out.join("\n");
  return { text: text.slice(0, ls) + block + text.slice(le), start: ls, end: ls + block.length };
}

/** Cycles `##` → `###` → `####` → none, from `##` because a post's `#` is the size of the page title. */
export function cycleHeading(text: string, start: number, end: number): TextEdit {
  const [ls] = lineSpan(text, start, end);
  const first = text.slice(ls, text.indexOf("\n", ls) === -1 ? text.length : text.indexOf("\n", ls));
  const current = HEADING_MARK.exec(first)?.[0].trim().length ?? 0;
  const next = current === 0 ? 2 : current === 2 ? 3 : current === 3 ? 4 : 0;
  if (next === 0) {
    const [s2, e2] = lineSpan(text, start, end);
    const lines = text.slice(s2, e2).split("\n").map((l) => l.replace(HEADING_MARK, ""));
    const block = lines.join("\n");
    return { text: text.slice(0, s2) + block + text.slice(e2), start: s2, end: s2 + block.length };
  }
  return prefixLines(text, start, end, { heading: next as 2 | 3 | 4 });
}

/** A link out of the selection, no dialog: a URL becomes the target, text the label with `url` left selected. */
export function insertLink(text: string, start: number, end: number): TextEdit {
  const [s0, e0] = order(start, end);
  const [s, e] = trimmed(text, s0, e0);
  const sel = text.slice(s, e);
  if (/^https?:\/\/\S+$/i.test(sel)) {
    const out = `[](${sel})`;
    return { text: text.slice(0, s) + out + text.slice(e), start: s + 1, end: s + 1 };
  }
  if (sel) {
    const out = `[${sel}](url)`;
    const urlAt = s + sel.length + 3;
    return { text: text.slice(0, s) + out + text.slice(e), start: urlAt, end: urlAt + 3 };
  }
  return { text: text.slice(0, s0) + "[]()" + text.slice(s0), start: s0 + 1, end: s0 + 1 };
}

function wrapCall(text: string, start: number, end: number, fn: string): TextEdit {
  const [s0, e0] = order(start, end);
  const [s, e] = trimmed(text, s0, e0);
  const sel = text.slice(s, e);
  if (sel) {
    const out = `${fn}(${sel})`;
    return { text: text.slice(0, s) + out + text.slice(e), start: s + out.length, end: s + out.length };
  }
  const out = `${fn}()`;
  return { text: text.slice(0, s0) + out + text.slice(s0), start: s0 + fn.length + 1, end: s0 + fn.length + 1 };
}

/** `img(url)` — the title on the button names `img220(url)` for a width. */
export function insertImage(text: string, start: number, end: number): TextEdit {
  return wrapCall(text, start, end, "img");
}

/** `youtube(url)`; `webm(url)` is typed by hand, it is the rarer one. */
export function insertVideo(text: string, start: number, end: number): TextEdit {
  return wrapCall(text, start, end, "youtube");
}

/** `~~~x~~~` on one line; a selection across lines gets the fenced form. */
export function wrapCenter(text: string, start: number, end: number): TextEdit {
  const [s0, e0] = order(start, end);
  const sel = text.slice(s0, e0);
  if (sel.includes("\n")) return wrapSelection(text, s0, e0, "~~~\n", "\n~~~");
  return wrapSelection(text, s0, e0, "~~~", "~~~");
}

/** Inline code for a selection on one line, a ``` fence across lines. */
export function fenceCode(text: string, start: number, end: number): TextEdit {
  const [s0, e0] = order(start, end);
  const sel = text.slice(s0, e0);
  if (!sel.includes("\n")) return wrapSelection(text, s0, e0, "`", "`");
  const [s, e] = trimmed(text, s0, e0);
  const lead = s > 0 && text[s - 1] !== "\n" ? "\n" : "";
  const tail = e < text.length && text[e] !== "\n" ? "\n" : "";
  const out = `${lead}\`\`\`\n${text.slice(s, e)}\n\`\`\`${tail}`;
  return { text: text.slice(0, s) + out + text.slice(e), start: s, end: s + out.length };
}

/** The smallest replacement turning `before` into `after`, so one `insertText` makes one undo step. */
export function editSpan(before: string, after: string): { start: number; end: number; insert: string } {
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before[p] === after[p]) p += 1;
  let q = 0;
  while (q < max - p && before[before.length - 1 - q] === after[after.length - 1 - q]) q += 1;
  return { start: p, end: before.length - q, insert: after.slice(p, after.length - q) };
}
