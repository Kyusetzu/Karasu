/**
 * What counts as a postable message.
 *
 * Shared by the activity composer, the reply box and the thread comment box, so
 * the three cannot disagree about whether a wall of spaces is a post.
 *
 * The reason it returns a *key* rather than a sentence: `i18nKeys.test.ts` only
 * sees literal `t("…")` calls, so a pure function that returned prose would put
 * its strings outside the suite's reach. The component maps the key through a
 * literal switch, the same shape `receiptText` uses in `useListMutations`.
 */
export type PostRejection = "empty" | "tooLong";

export interface PostValidation {
  ok: boolean;
  reason?: PostRejection;
  /** What to actually send: trimmed, with runs of blank lines collapsed. */
  text: string;
}

/**
 * Karasu's own bound: AniList's schema documents no maximum for activity text.
 *
 * Generous rather than tight — a status update is not a tweet and people do
 * write paragraphs — but still a number, because a field with no limit is one
 * that eventually receives a pasted novel and fails at the API instead of in
 * the box where it could be explained.
 */
export const POST_MAX = 4000;

export function validatePost(raw: string): PostValidation {
  // Three or more newlines become two: AniList renders single newlines as
  // breaks, so a stray run of blank lines is a wall of nothing in the feed.
  const text = raw.trim().replace(/\n{3,}/g, "\n\n");
  if (!text) return { ok: false, reason: "empty", text };
  // Counted on the trimmed text, so trailing whitespace cannot push a valid
  // post over the edge.
  if (text.length > POST_MAX) return { ok: false, reason: "tooLong", text };
  return { ok: true, text };
}

/**
 * Characters left, for a counter that only appears when it matters.
 *
 * Negative once over, so the caller can style it without repeating the
 * comparison.
 */
export function charsLeft(raw: string): number {
  return POST_MAX - raw.trim().length;
}

/**
 * What counts as a postable thread — a title, a body, and at least one
 * category.
 *
 * AniList's own composer enforces the category; a threadless category is fine
 * but a categoryless thread lands nowhere anyone browses. The title bound is
 * Karasu's, like `POST_MAX`: AniList documents none, and the forum renders
 * titles on one line.
 */
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

/**
 * What counts as a publishable review. Unlike the two above, every bound
 * here is **AniList's own**, enforced server-side — validating locally just
 * moves the rejection from a failed request into the box where it can be
 * explained while typing.
 */
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

// --- Editing ---------------------------------------------------------------
//
// The formatting toolbar's arithmetic, as pure functions over (text, start,
// end): each returns the new text and where the selection should land. Pure
// so it is testable in node and shared by every composer; the component's
// only job is to read the textarea's selection and write the result back.

/** The text after an edit, and the selection to leave in it. */
export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

/** The inline marks, as the pair of markers each wraps in. Italic is `*x*`
 *  and never `_x_`: `_` is inert inside a word and AniList's own parser has
 *  a bug below three characters with it. */
export const INLINE_MARKS = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  strike: ["~~", "~~"],
  spoiler: ["~!", "!~"],
  code: ["`", "`"],
} as const satisfies Record<string, readonly [string, string]>;

const order = (start: number, end: number): [number, number] =>
  start <= end ? [start, end] : [end, start];

/** The selection with its leading and trailing whitespace given back to the
 *  outside — the parser refuses `** x**`, so a wrapped selection must not
 *  start or end on a space. */
function trimmed(text: string, start: number, end: number): [number, number] {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s])) s += 1;
  while (e > s && /\s/.test(text[e - 1])) e -= 1;
  return [s, e];
}

/**
 * Wraps the selection in `before`/`after`, or unwraps it when it already is —
 * whether the markers sit just outside the selection or just inside it. With
 * nothing selected the markers are inserted with the caret between them.
 */
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
  // Markers just outside: `**|sel|**` → toggle off.
  //
  // For a marker that is one character repeated — `*`, `**`, `~~`, `~~~` —
  // the *run* either side decides, not the exact slice: the `*` either side
  // of `word` in `**word**` is bold's second star, not italic to switch off.
  // Bold is on from a run of two; italic is on at an odd run (`*` or `***`),
  // and so italic inside bold wraps to `***word***` and unwraps back.
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

/**
 * Puts a block prefix in front of every line the selection touches, or takes
 * it off when every line already carries it. A numbered list is renumbered
 * from 1; a heading replaces whatever heading level was there. The whole
 * block is selected afterwards, so a second press toggles it back.
 */
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

/**
 * Steps the heading level of the selected lines: none → `##` → `###` →
 * `####` → none. One button rather than six, and it starts at `##` because
 * a post's `#` is the size of the page title around it.
 */
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

/**
 * A link out of the selection. A selected URL becomes the target with the
 * caret in the empty label; selected text becomes the label with the word
 * `url` selected so typing replaces it; nothing selected gives `[]()` with
 * the caret in the label. No dialog — the text is the form.
 */
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

/**
 * The smallest replacement that turns `before` into `after`: the common
 * prefix and suffix are left alone. This is what lets the component hand an
 * edit to the browser as one `insertText` — a single undo step with the
 * caret where the user expects — instead of replacing the whole value.
 */
export function editSpan(before: string, after: string): { start: number; end: number; insert: string } {
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before[p] === after[p]) p += 1;
  let q = 0;
  while (q < max - p && before[before.length - 1 - q] === after[after.length - 1 - q]) q += 1;
  return { start: p, end: before.length - q, insert: after.slice(p, after.length - q) };
}
