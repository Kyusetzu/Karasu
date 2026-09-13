import type { FuzzyDate, MediaListEntry, MediaType } from "@/api/types";
import { displayTitle } from "@/api/types";
import { toRaw, type ScoreFormat } from "@/lib/scoreFormat";

/** The MyAnimeList XML export; a title with no `idMal` cannot appear, so it is counted rather than silently dropped. */

/** MAL's status vocabulary; REPEATING maps to the active status, since an unknown status drops the entry on import. */
function malStatus(status: string, type: MediaType): string {
  switch (status) {
    case "CURRENT":
    case "REPEATING":
      return type === "ANIME" ? "Watching" : "Reading";
    case "PLANNING":
      return type === "ANIME" ? "Plan to Watch" : "Plan to Read";
    case "COMPLETED":
      return "Completed";
    case "DROPPED":
      return "Dropped";
    case "PAUSED":
      return "On-Hold";
    default:
      return "Completed";
  }
}

/** MAL has no partial dates, so anything short of a full date exports as its own null rather than a guessed day. */
export function malDate(date: FuzzyDate | null | undefined): string {
  if (!date || date.year == null || date.month == null || date.day == null) {
    return "0000-00-00";
  }
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `${date.year}-${mm}-${dd}`;
}

/** CDATA can hold anything except its own terminator, so a title containing `]]>` is split across two sections. */
export function cdata(text: string): string {
  return `<![CDATA[${text.split("]]>").join("]]]]><![CDATA[>")}]]>`;
}

export interface MalExport {
  xml: string;
  /** Entries exported. */
  count: number;
  /** Entries with no MAL id, left out and owed a mention. */
  skipped: number;
  /** Entries left out because they are marked private. */
  omitted: number;
}

export function buildMalXml(
  entries: MediaListEntry[],
  type: MediaType,
  format: ScoreFormat,
): MalExport {
  const rows: string[] = [];
  let skipped = 0;
  let omitted = 0;

  for (const e of entries) {
    // This export hands the list to someone else, so "private" means left out here; the JSON backup keeps the row.
    if (e.private) {
      omitted += 1;
      continue;
    }
    const mal = e.media.idMal;
    if (mal == null) {
      skipped += 1;
      continue;
    }
    // MAL scores are whole numbers out of ten, and the raw scale is where every AniList format converges.
    const score = Math.round(toRaw(format, e.score) / 10);
    const start = malDate(e.startedAt);
    const finish = malDate(e.completedAt);
    const title = cdata(displayTitle(e.media.title));

    if (type === "ANIME") {
      rows.push(
        [
          "\t<anime>",
          `\t\t<series_animedb_id>${mal}</series_animedb_id>`,
          `\t\t<series_title>${title}</series_title>`,
          `\t\t<series_episodes>${e.media.episodes ?? 0}</series_episodes>`,
          `\t\t<my_watched_episodes>${e.progress}</my_watched_episodes>`,
          `\t\t<my_start_date>${start}</my_start_date>`,
          `\t\t<my_finish_date>${finish}</my_finish_date>`,
          `\t\t<my_score>${score}</my_score>`,
          `\t\t<my_status>${malStatus(e.status, type)}</my_status>`,
          `\t\t<my_times_watched>${e.repeat}</my_times_watched>`,
          "\t\t<update_on_import>1</update_on_import>",
          "\t</anime>",
        ].join("\n"),
      );
    } else {
      rows.push(
        [
          "\t<manga>",
          `\t\t<manga_mangadb_id>${mal}</manga_mangadb_id>`,
          `\t\t<manga_title>${title}</manga_title>`,
          `\t\t<manga_chapters>${e.media.chapters ?? 0}</manga_chapters>`,
          `\t\t<manga_volumes>${e.media.volumes ?? 0}</manga_volumes>`,
          `\t\t<my_read_chapters>${e.progress}</my_read_chapters>`,
          `\t\t<my_read_volumes>${e.progressVolumes}</my_read_volumes>`,
          `\t\t<my_start_date>${start}</my_start_date>`,
          `\t\t<my_finish_date>${finish}</my_finish_date>`,
          `\t\t<my_score>${score}</my_score>`,
          `\t\t<my_status>${malStatus(e.status, type)}</my_status>`,
          `\t\t<my_times_read>${e.repeat}</my_times_read>`,
          "\t\t<update_on_import>1</update_on_import>",
          "\t</manga>",
        ].join("\n"),
      );
    }
  }

  const exportType = type === "ANIME" ? 1 : 2;
  const totalTag =
    type === "ANIME"
      ? `\t\t<user_total_anime>${rows.length}</user_total_anime>`
      : `\t\t<user_total_manga>${rows.length}</user_total_manga>`;
  const xml = [
    `<?xml version="1.0" encoding="UTF-8" ?>`,
    "<myanimelist>",
    "\t<myinfo>",
    `\t\t<user_export_type>${exportType}</user_export_type>`,
    totalTag,
    "\t</myinfo>",
    ...rows,
    "</myanimelist>",
    "",
  ].join("\n");

  return { xml, count: rows.length, skipped, omitted };
}

/** The JSON export in Karasu's own shape; keep every list field the app reads here, since a backup that omits is not one. */
export function buildJsonExport(
  anime: MediaListEntry[],
  manga: MediaListEntry[],
  format: ScoreFormat,
  exportedAtMs: number,
): string {
  const slim = (e: MediaListEntry) => ({
    media: {
      id: e.media.id,
      idMal: e.media.idMal ?? null,
      title: e.media.title,
      format: e.media.format,
      episodes: e.media.episodes,
      chapters: e.media.chapters ?? null,
      volumes: e.media.volumes ?? null,
    },
    status: e.status,
    scoreRaw: toRaw(format, e.score),
    progress: e.progress,
    progressVolumes: e.progressVolumes,
    repeat: e.repeat,
    notes: e.notes,
    startedAt: e.startedAt,
    completedAt: e.completedAt,
    private: e.private,
    hiddenFromStatusLists: e.hiddenFromStatusLists ?? null,
    // Carried as read, not pre-converted: the order `advancedScores` writes in is the account's, which a file cannot pin.
    customLists: e.customLists ?? null,
    advancedScores: e.advancedScores ?? null,
  });
  return `${JSON.stringify(
    {
      source: "karasu",
      exportedAt: new Date(exportedAtMs).toISOString(),
      scoreFormat: format,
      anime: anime.map(slim),
      manga: manga.map(slim),
    },
    null,
    2,
  )}\n`;
}
