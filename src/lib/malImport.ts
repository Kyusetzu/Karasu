import type { FuzzyDate } from "@/api/types";

/**
 * Reading a MyAnimeList XML export back in — the mirror of `lib/malExport`.
 *
 * A hand extractor rather than `DOMParser`, for two load-bearing reasons: the
 * node test project has no DOM, and the format is flat by construction — one
 * level of known tags inside `<anime>`/`<manga>` blocks, no attributes worth
 * reading. Everything unrecognisable degrades to a *counted* skip, because an
 * import that silently drops rows is how two trackers drift apart without
 * anyone noticing.
 */

export interface MalImportRow {
  idMal: number;
  title: string;
  status: "CURRENT" | "PLANNING" | "COMPLETED" | "DROPPED" | "PAUSED" | "REPEATING";
  /** Ten-point, exactly as MAL stores it — which is local mode's own scale. */
  score: number;
  progress: number;
  /** Manga only; 0 elsewhere. */
  progressVolumes: number;
  repeat: number;
  startedAt: FuzzyDate | null;
  completedAt: FuzzyDate | null;
}

export interface MalImportResult {
  type: "ANIME" | "MANGA";
  rows: MalImportRow[];
  /** Blocks that had no usable MAL id — counted, never silently dropped. */
  skipped: number;
}

/** First `<tag>…</tag>` in a block, CDATA unwrapped and entities decoded. */
function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!m) return null;
  let text = m[1].trim();
  const cd = text.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cd) text = cd[1];
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function num(block: string, name: string): number {
  const n = Number(tag(block, name) ?? "");
  return Number.isFinite(n) ? n : 0;
}

/** `2024-03-09` → fuzzy date; MAL's `0000-00-00` (and any malformed spelling)
    is null. Partial forms with a zero day keep what they do have. */
export function parseMalDate(text: string | null): FuzzyDate | null {
  const m = text?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year === 0) return null;
  return {
    year,
    month: month === 0 ? null : month,
    day: day === 0 ? null : day,
  };
}

/** MAL's status words (case-insensitive, both media vocabularies) → AniList's. */
export function parseMalStatus(text: string | null): MalImportRow["status"] | null {
  switch (text?.trim().toLowerCase()) {
    case "watching":
    case "reading":
      return "CURRENT";
    case "plan to watch":
    case "plan to read":
      return "PLANNING";
    case "completed":
      return "COMPLETED";
    case "dropped":
      return "DROPPED";
    case "on-hold":
      return "PAUSED";
    default:
      return null;
  }
}

export function parseMalXml(xml: string): MalImportResult {
  // The element name is the truth about the medium; user_export_type is only
  // a header and real-world files have carried the wrong one.
  const animeBlocks = [...xml.matchAll(/<anime>([\s\S]*?)<\/anime>/g)].map((m) => m[1]);
  const mangaBlocks = [...xml.matchAll(/<manga>([\s\S]*?)<\/manga>/g)].map((m) => m[1]);
  const type: MalImportResult["type"] = mangaBlocks.length > animeBlocks.length ? "MANGA" : "ANIME";
  const blocks = type === "ANIME" ? animeBlocks : mangaBlocks;

  const rows: MalImportRow[] = [];
  let skipped = 0;
  for (const block of blocks) {
    const idMal =
      type === "ANIME" ? num(block, "series_animedb_id") : num(block, "manga_mangadb_id");
    if (!Number.isInteger(idMal) || idMal <= 0) {
      skipped += 1;
      continue;
    }
    const title =
      (type === "ANIME" ? tag(block, "series_title") : tag(block, "manga_title")) ?? "";
    // A rewatch count with the "Watching" status is MAL's spelling of
    // REPEATING-in-progress only when the show was already completed once;
    // without that context the safe read is the literal status.
    const status = parseMalStatus(tag(block, "my_status")) ?? "PLANNING";
    const score = Math.min(10, Math.max(0, num(block, "my_score")));
    rows.push({
      idMal,
      title,
      status,
      score,
      progress:
        type === "ANIME" ? num(block, "my_watched_episodes") : num(block, "my_read_chapters"),
      progressVolumes: type === "ANIME" ? 0 : num(block, "my_read_volumes"),
      repeat: type === "ANIME" ? num(block, "my_times_watched") : num(block, "my_times_read"),
      startedAt: parseMalDate(tag(block, "my_start_date")),
      completedAt: parseMalDate(tag(block, "my_finish_date")),
    });
  }
  return { type, rows, skipped };
}
