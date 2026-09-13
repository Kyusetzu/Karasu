import type { FuzzyDate, Media, MediaListStatus, MediaType } from "@/api/types";

/** Reads Karasu's own JSON export back in without a request, and counts every unusable row rather than dropping it. */

export interface JsonImportRow {
  mediaId: number;
  mediaType: MediaType;
  title: string;
  /** The export's trimmed media block rebuilt as a `Media`, stored by local mode so the list renders offline. */
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

/** A fuzzy date only if it has a year; every other part is independently nullable, as on AniList. */
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
    // The id makes the row importable without a request and the status decides its list; without either it is no row.
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
      // Clamped rather than trusted: a hand-edited score above the scale would be written to a list.
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

/** Parses a `buildJsonExport` file; throws only on non-JSON, and the wrong shape or `source` yields zero rows. */
export function parseJsonExport(text: string): JsonImportResult {
  const data = JSON.parse(text) as Record<string, unknown>;
  const out: JsonImportResult = { rows: [], skipped: 0 };
  if (!data || typeof data !== "object" || data.source !== "karasu") return out;
  rowsFrom(data.anime, "ANIME", out);
  rowsFrom(data.manga, "MANGA", out);
  return out;
}
