/** Fuzzy search: exact > substring > word-prefix > trigram containment, scored per title, never a joined haystack. */

export interface FuzzyTitle {
  norm: string;
  tokens: string[];
  grams: Set<string>;
}

/** One searchable entry: each of its names, prepared once. */
export interface FuzzyDoc {
  titles: FuzzyTitle[];
}

export type PreparedQuery = FuzzyTitle;

/** Lowercase, fold diacritics (nobody types "Pokémon"; NFD is inert for kana and kanji), keep letters and digits. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Codepoint trigrams over the padded string (two leading spaces, one trailing), the same windows as the Rust matcher. */
export function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  const cp = Array.from("  " + s + " ");
  for (let i = 0; i + 2 < cp.length; i++) {
    out.add(cp[i] + cp[i + 1] + cp[i + 2]);
  }
  return out;
}

/** Dice similarity, with the matcher's empty-set guard: no grams, no score. */
export function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const g of a) if (b.has(g)) common++;
  return (2 * common) / (a.size + b.size);
}

function prepare(s: string): FuzzyTitle {
  const norm = normalize(s);
  return { norm, tokens: norm ? norm.split(" ") : [], grams: trigrams(norm) };
}

/** Prepared once per entry (per list change), never per keystroke. */
export function prepareDoc(titles: (string | null | undefined)[]): FuzzyDoc {
  const out: FuzzyTitle[] = [];
  for (const t of titles) {
    if (!t) continue;
    const p = prepare(t);
    if (p.norm) out.push(p);
  }
  return { titles: out };
}

export function prepareQuery(q: string): PreparedQuery {
  return prepare(q);
}

/** Below this share of the query's trigrams a title is noise rather than a typo. */
const CONTAINMENT_FLOOR = 0.5;

function scoreTitle(t: FuzzyTitle, q: PreparedQuery): number {
  if (t.norm === q.norm) return 1;
  if (t.norm.includes(q.norm)) {
    return 0.8 + 0.2 * (q.norm.length / t.norm.length);
  }
  // Every query word prefixes its own title word in any order; longest first, so a stray "k" cannot steal "kimetsu".
  if (q.tokens.length > 0 && q.tokens.length <= t.tokens.length) {
    const used = new Array<boolean>(t.tokens.length).fill(false);
    const byLength = [...q.tokens].sort((a, b) => b.length - a.length);
    let matched = 0;
    for (const qt of byLength) {
      const at = t.tokens.findIndex((tt, i) => !used[i] && tt.startsWith(qt));
      if (at === -1) break;
      used[at] = true;
      matched++;
    }
    if (matched === q.tokens.length) {
      const qLen = q.tokens.reduce((n, x) => n + x.length, 0);
      const tLen = t.tokens.reduce((n, x) => n + x.length, 0);
      return 0.6 + 0.2 * Math.min(1, qLen / tLen);
    }
  }
  // Typos; skipped for queries shorter than one trigram window, where it means nothing.
  if (Array.from(q.norm).length >= 3 && t.grams.size > 0) {
    let common = 0;
    for (const g of q.grams) if (t.grams.has(g)) common++;
    const overlap = common / q.grams.size;
    if (overlap >= CONTAINMENT_FLOOR) return 0.6 * overlap;
  }
  return 0;
}

/** 0 means no match; everything above it is orderable relevance. */
export function fuzzyScore(doc: FuzzyDoc, q: PreparedQuery): number {
  if (!q.norm) return 0;
  let best = 0;
  for (const t of doc.titles) {
    const s = scoreTitle(t, q);
    if (s > best) best = s;
    if (best === 1) break;
  }
  return best;
}
