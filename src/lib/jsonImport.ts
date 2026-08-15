import type { FuzzyDate, Media, MediaListStatus, MediaType } from "@/api/types";

/**
 * Reading Karasu's own JSON export back in — the half that was missing.
 *
 * The app could write this file and not read it, which makes it an export
 * rather than a backup: the only way back in was a MyAnimeList XML, which
 * carries neither AniList ids nor private flags nor the two axes manga is
 * tracked on. This closes that.
 *
 * It is a *parser*, not a fetch: everything it needs is in the file, including
 * the AniList media id, so an import costs no requests at all. That is the
 * whole reason the export carries `media.id` and `scoreRaw` — a
 * format-independent integer nobody has to guess the meaning of.
 *
 * Everything unusable is counted rather than dropped, on the same principle as
 * `malImport`: an import that silently loses rows is how two copies of a list
 * drift apart without anyone noticing.
 */

export interface JsonImportRow {
  mediaId: number;
  mediaType: MediaType;
  title: string;
  /**
   * The export's trimmed media block, rebuilt as a `Media`.
   *
   * Local mode stores this beside the row so the list renders offline — without
   * it an imported entry is a title-less card waiting on a fetch that local
   * mode never makes. AniList mode ignores it, as it does for the MAL path.
   */
  media: Media;
  status: MediaListStatus;
  /** The 0–100 raw score, exactly as exported. */
  scoreRaw: number;
  progress: number;
  progressVolumes: number;
  repeat: number;
  notes: string | null;
  startedAt: FuzzyDate | null;
  completedAt: FuzzyDate | null;
  private: boolean;
}

export interface JsonImportResult {
  rows: JsonImportRow[];
  /** Entries with no usable media id or status — counted, never silent. */
  skipped: number;
}

const STATUSES: MediaListStatus[] = [
  "CURRENT",
  "PLANNING",
  "COMPLETED",
  "DROPPED",
  "PAUSED",
  "REPEATING",
];

/** A number that is actually one, floored at zero; anything else is zero. */
function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * A fuzzy date only if it looks like one.
 *
 * Every part is independently nullable on AniList, so `{year: 2019}` is a real
 * answer rather than a broken one — but an object with no year at all is not a
 * date, and passing it on would put an empty `{}` where the app expects null.
 */
function fuzzy(value: unknown): FuzzyDate | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  const year = Number(d.year);
  if (!Number.isFinite(year) || year <= 0) return null;
  const part = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return { year, month: part(d.month), day: part(d.day) };
}

function rowsFrom(list: unknown, mediaType: MediaType, out: JsonImportResult) {
  if (!Array.isArray(list)) return;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") {
      out.skipped += 1;
      continue;
    }
    const e = raw as Record<string, unknown>;
    const media = (e.media ?? {}) as Record<string, unknown>;
    const mediaId = Number(media.id);
    const status = e.status as MediaListStatus;
    // The id is what makes this importable without a single request, and the
    // status is what decides which list it lands on. Without either, the row
    // is not one.
    if (!Number.isInteger(mediaId) || mediaId <= 0 || !STATUSES.includes(status)) {
      out.skipped += 1;
      continue;
    }
    const title = (media.title as Record<string, unknown> | undefined) ?? {};
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    out.rows.push({
      mediaId,
      mediaType,
      title:
        str(title.romaji) ?? str(title.english) ?? str(title.native) ?? `#${mediaId}`,
      media: {
        id: mediaId,
        type: mediaType,
        idMal: Number.isInteger(media.idMal) ? (media.idMal as number) : null,
        title: {
          romaji: str(title.romaji),
          english: str(title.english),
          native: str(title.native),
        },
        format: str(media.format),
        episodes: Number.isInteger(media.episodes) ? (media.episodes as number) : null,
        chapters: Number.isInteger(media.chapters) ? (media.chapters as number) : null,
        volumes: Number.isInteger(media.volumes) ? (media.volumes as number) : null,
      } as Media,
      status,
      // Clamped rather than trusted: this file may have been edited by hand,
      // and a score above the scale would be written to a list.
      scoreRaw: Math.min(100, count(e.scoreRaw)),
      progress: count(e.progress),
      progressVolumes: count(e.progressVolumes),
      repeat: count(e.repeat),
      notes: typeof e.notes === "string" ? e.notes : null,
      startedAt: fuzzy(e.startedAt),
      completedAt: fuzzy(e.completedAt),
      private: e.private === true,
    });
  }
}

/**
 * Parses an export produced by `buildJsonExport`.
 *
 * Throws only on text that is not JSON at all — a file of the wrong *shape*
 * comes back as zero rows, which the caller reports the same way it reports an
 * empty MAL import. The `source` marker is checked because a JSON file that
 * parses is not evidence of anything: someone will drop the wrong export in.
 */
export function parseJsonExport(text: string): JsonImportResult {
  const data = JSON.parse(text) as Record<string, unknown>;
  const out: JsonImportResult = { rows: [], skipped: 0 };
  if (!data || typeof data !== "object" || data.source !== "karasu") return out;
  rowsFrom(data.anime, "ANIME", out);
  rowsFrom(data.manga, "MANGA", out);
  return out;
}
