/**
 * Fuzzy text matching for the local search surfaces — the library filter, the
 * command palette, the local library's unplaced list and the tag picker.
 *
 * A TypeScript port of the scrobbler's matcher
 * (`src-tauri/src/playback/recognition/matcher.rs`): the same normalize →
 * trigram machinery, adapted for the one way a search box differs from a
 * filename matcher — the query is a *fragment* of a title, not a whole one.
 * Symmetric Dice at the matcher's 0.7 floor rejects "frieren" against
 * "Sousou no Frieren" (≈0.42), so the fuzzy tier here is trigram
 * *containment*: how much of what was typed is found in the title. Dice
 * itself stays below, exact and tested, as the primitive.
 *
 * Scoring is tiered so that everything the old substring filter matched still
 * matches, and ranks above anything merely fuzzy:
 *
 *   1.0        exact title
 *   0.8..1.0   substring — the tighter title ranks higher
 *   0.6..0.8   every query word prefixes a distinct title word, any order
 *   0.3..0.6   trigram containment ≥ 0.5, queries of 3+ characters only
 *
 * Titles are scored one at a time: a per-title document is what makes a query
 * structurally unable to match across two adjacent names — the straddle bug
 * the old NUL-joined haystack existed to prevent.
 */

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

/**
 * Lowercase, fold diacritics, keep only letters and digits.
 *
 * The diacritic fold is a deliberate extension over the Rust normalize (which
 * compares release names to titles, both effectively ASCII): a search box
 * compares *typing* to titles, and nobody types "Pokémon". NFD is inert for
 * kana and kanji, so native titles pass through unharmed.
 */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Codepoint trigrams over the padded string — the matcher's byte windows,
 * identical for ASCII and sharper for CJK, where byte windows straddle
 * characters. Two leading spaces and one trailing, same as the Rust.
 */
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

/**
 * Below this share of the query's trigrams, a title is noise rather than a
 * typo. One wrong letter in a ten-character query still clears it (~0.73);
 * "half the words happen to appear somewhere" does not.
 */
const CONTAINMENT_FLOOR = 0.5;

function scoreTitle(t: FuzzyTitle, q: PreparedQuery): number {
  if (t.norm === q.norm) return 1;
  if (t.norm.includes(q.norm)) {
    return 0.8 + 0.2 * (q.norm.length / t.norm.length);
  }
  // Every query word a prefix of its own title word, any order — what lets
  // "kimetsu yaiba" find "Kimetsu no Yaiba". Longest query words claim their
  // title word first, so a stray "k" cannot steal the word "kimetsu" needs.
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
  // Typos. Skipped for one- and two-character queries, where a
  // three-character window means nothing.
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
