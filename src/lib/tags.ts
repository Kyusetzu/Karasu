/** Custom tags in a `[[karasu:tags]]` block appended to the notes; when in doubt, no tags and the notes verbatim. */

const TAG_BLOCK_RE = /\[\[karasu:tags\]\]([\s\S]*?)\[\[\/karasu:tags\]\]/;

/** AniList caps and our own sanity limits. */
export const MAX_TAGS = 20;
export const MAX_TAG_LEN = 30;

export interface ParsedNotes {
  /** User-facing notes with the tag block removed (only when tags parsed). */
  notes: string;
  tags: string[];
}

/** Trim, drop empties, truncate over-long, case-insensitively dedupe, cap. */
export function normalizeTags(parts: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    let tag = raw.trim();
    if (!tag) continue;
    if (tag.length > MAX_TAG_LEN) tag = tag.slice(0, MAX_TAG_LEN).trim();
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Splits notes into prose and tags from the first well-formed block, returning the raw string when it yields none. */
export function parseNotes(raw: string | null | undefined): ParsedNotes {
  const source = raw ?? "";
  const match = TAG_BLOCK_RE.exec(source);
  if (!match) return { notes: source, tags: [] };

  const tags = normalizeTags(match[1].split(","));
  if (tags.length === 0) return { notes: source, tags: [] };

  const notes = (
    source.slice(0, match.index) + source.slice(match.index + match[0].length)
  ).replace(/\s+$/, "");
  return { notes, tags };
}

/** Convenience: just the tags of a notes string. */
export function tagsOf(raw: string | null | undefined): string[] {
  return parseNotes(raw).tags;
}

/** Remove any well-formed tag block from a string. */
function stripTagBlock(s: string): string {
  return s.replace(TAG_BLOCK_RE, "");
}

/** Re-assembles notes plus tags, stripping any existing block first so round-trips can never accumulate blocks. */
export function serializeNotes(userNotes: string, tags: readonly string[]): string {
  const base = stripTagBlock(userNotes).replace(/\s+$/, "");
  const clean = normalizeTags(tags);
  if (clean.length === 0) return base;
  const block = `[[karasu:tags]]${clean.join(", ")}[[/karasu:tags]]`;
  return base ? `${base}\n\n${block}` : block;
}

/** Union of all tags across entries' notes, sorted for stable autocomplete. */
export function collectTags(notes: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  for (const n of notes) {
    for (const tag of tagsOf(n)) {
      if (!seen.has(tag.toLowerCase())) seen.add(tag.toLowerCase());
    }
  }
  // Rebuild original-cased list (first occurrence wins).
  const out: string[] = [];
  const added = new Set<string>();
  for (const n of notes) {
    for (const tag of tagsOf(n)) {
      const key = tag.toLowerCase();
      if (seen.has(key) && !added.has(key)) {
        added.add(key);
        out.push(tag);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}
