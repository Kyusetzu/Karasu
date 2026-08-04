import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, FolderOpen, Play, RefreshCw } from "lucide-react";
import { fetchMediaList, isTauri } from "@/api/anilist";
import { displayTitle, type MediaListEntry } from "@/api/types";
import {
  getLibraryStatus,
  pickLibraryFolder,
  scanLibrary,
  setLibraryPath,
  type LibraryEntry,
  type LibraryFile,
} from "@/api/library";
import { useAuth } from "@/stores/auth";
import { useLibrary } from "@/stores/library";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked } from "@/lib/contentFilter";
import { Button } from "@/components/ui/button";
import { EmptyState, FolderStack } from "@/components/EmptyState";
import { cn } from "@/lib/utils";

/** Above this the matcher hit the title exactly; below it, it guessed. */
const EXACT = 0.999;

/**
 * The scanned local library. The index only stores media ids, so titles come
 * from the cached anime list — the scanner only ever matches titles already
 * on it, so the join always resolves and costs no extra AniList request.
 */
export default function LocalLibrary() {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const loading = useAuth((s) => s.loading);

  if (loading) return null;

  if (!viewer && mode !== "local") {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="text-center">
          <p className="text-ink-500">{t("list.connectPrompt")}</p>
          {/* Account, not Library: this prompt is about being signed out. */}
          <Link to="/settings">
            <Button className="mt-4">{t("list.toSettings")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return <LibraryView userId={viewer?.id ?? 0} />;
}

interface Row {
  lib: LibraryEntry;
  entry: MediaListEntry;
  /** The first file past the user's progress, if there is one. */
  next: LibraryFile | null;
}

function LibraryView({ userId }: { userId: number }) {
  const { t } = useTranslation();
  const entries = useLibrary((s) => s.entries);
  const refresh = useLibrary((s) => s.refresh);
  const level = useContentFilter((s) => s.level);
  const [scanning, setScanning] = useState(false);

  const { data } = useQuery({
    queryKey: ["mediaList", "ANIME", userId],
    queryFn: () => fetchMediaList(userId, "ANIME"),
  });

  // What the path row says. Kept in the cache rather than in state so a rescan
  // can invalidate it in one place.
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ["libraryStatus"],
    queryFn: getLibraryStatus,
    enabled: isTauri,
  });

  // media_id → list entry, so each library row can show cover and progress.
  // Filtered titles never enter the map, so they cannot be listed here even
  // though the scanner still indexes them (playback itself stays intact).
  const byMedia = useMemo(() => {
    const map = new Map<number, MediaListEntry>();
    for (const group of data?.lists ?? []) {
      if (group.isCustomList) continue;
      for (const e of group.entries) {
        if (isBlocked(e.media, level)) continue;
        map.set(e.mediaId, e);
      }
    }
    return map;
  }, [data, level]);

  const rows = useMemo<Row[]>(
    () =>
      entries
        .flatMap((lib) => {
          const entry = byMedia.get(lib.mediaId);
          if (!entry) return [];
          const next = lib.files.find((f) => f.episode > entry.progress) ?? null;
          return [{ lib, entry, next }];
        })
        .sort((a, b) =>
          displayTitle(a.entry.media.title).localeCompare(
            displayTitle(b.entry.media.title),
          ),
        ),
    [entries, byMedia],
  );

  // The split is the screen's whole argument: one group is a list of things to
  // do tonight, the other is a list of things already done.
  const ready = rows.filter((r) => r.next);
  const done = rows.filter((r) => !r.next);

  const rescan = async () => {
    setScanning(true);
    try {
      await scanLibrary();
      await refresh();
      await refetchStatus();
    } catch {
      /* the folder may be unset — Settings owns that flow */
    } finally {
      setScanning(false);
    }
  };

  const change = async () => {
    const picked = await pickLibraryFolder();
    if (!picked) return;
    await setLibraryPath(picked);
    await rescan();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none px-8 pb-4 pt-7">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[1.375rem] font-bold tracking-[-.015em] text-ink-100">
            {t("library.title")}
          </h1>
          <span className="font-brand-jp text-[.8125rem] tracking-[.04em] text-ink-600">
            ライブラリ
          </span>
          <Button
            variant="outline"
            size="control"
            className="ml-auto"
            onClick={rescan}
            disabled={scanning}
          >
            <RefreshCw className={cn("size-3.5", scanning && "animate-spin")} />
            {scanning ? t("settings.libraryScanning") : t("settings.libraryScan")}
          </Button>
        </div>

        {/* The folder, and what the last scan made of it. Without this the
            screen never says where any of these files came from. */}
        <div className="mt-3.5 flex max-w-176 items-center gap-2.5 rounded-lg border border-surface-800 bg-surface-900 px-3 py-2.25">
          <FolderOpen className="size-3.75 shrink-0 text-ink-500" />
          <span className="min-w-0 flex-1 truncate text-xs tabular-nums text-ink-300">
            {status?.path ?? t("library.noFolder")}
          </span>
          {status && status.filesSeen > 0 && (
            <>
              <span className="shrink-0 text-2xs tabular-nums text-ink-600">
                {t("library.filesMatched", {
                  files: status.filesSeen.toLocaleString(),
                  matched: status.matched,
                })}
              </span>
              <span className="h-4 w-px shrink-0 bg-surface-800" />
            </>
          )}
          <button
            type="button"
            onClick={change}
            className="shrink-0 text-2xs font-medium text-accent-400 hover:underline"
          >
            {t("library.change")}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
        {rows.length === 0 ? (
          <EmptyState
            visual={<FolderStack />}
            title={t("library.empty")}
            hint={t("library.emptyHint")}
            actions={
              <Link to="/settings?pane=library">
                <Button size="control">{t("library.toSettings")}</Button>
              </Link>
            }
          />
        ) : (
          <>
            <Group label={t("library.readyToPlay")} rows={ready} />
            <Group label={t("library.upToDate")} rows={done} muted />
          </>
        )}
      </div>
    </div>
  );
}


/** One captioned block of rows, in a single bordered container. */
function Group({
  label,
  rows,
  muted = false,
}: {
  label: string;
  rows: Row[];
  muted?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="pt-4">
      <p className="mb-3 text-[.6875rem] font-medium uppercase tracking-[.12em] text-ink-600">
        {label}
      </p>
      <div className="overflow-hidden rounded-xl border border-hair">
        {rows.map((row) => (
          <LibraryRow key={row.lib.mediaId} row={row} muted={muted} />
        ))}
      </div>
    </section>
  );
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

function LibraryRow({ row, muted }: { row: Row; muted: boolean }) {
  const { t } = useTranslation();
  const playEpisode = useLibrary((s) => s.playEpisode);
  const [open, setOpen] = useState(false);
  const { lib, entry, next } = row;
  const { media } = entry;
  const title = displayTitle(media.title);
  const exact = lib.score >= EXACT;

  return (
    <div className="border-b border-surface-950 bg-surface-900 transition-surface last:border-b-0 hover:bg-surface-850">
      <div className="flex items-center gap-3.5 px-3.5 py-2">
        <Link to={`/media/${lib.mediaId}`} className="shrink-0">
          <div className="h-13 w-8.75 overflow-hidden rounded-md bg-surface-800">
            {media.coverImage.large && (
              <img
                src={media.coverImage.large}
                alt=""
                loading="lazy"
                className="size-full object-cover"
              />
            )}
          </div>
        </Link>

        <span className="min-w-0 flex-1">
          <Link
            to={`/media/${lib.mediaId}`}
            className="block truncate text-[.8125rem] font-medium text-ink-100 hover:text-accent-400"
          >
            {title}
          </Link>
          {/* The file, not a summary of it. This is the one screen where the
              name on disk is the thing being talked about. */}
          <span className="block truncate text-[.6875rem] text-ink-600">
            {next ? fileName(next.path) : t("library.watchedOf", {
              progress: entry.progress,
              total: media.episodes ?? lib.episodes.length,
            })}
          </span>
        </span>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-2xs tabular-nums text-ink-600 transition-surface hover:bg-surface-800 hover:text-ink-300"
        >
          {t("library.fileCount", { n: lib.files.length })}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>

        <span
          className={cn(
            "w-22 shrink-0 text-right text-xs",
            exact ? "text-ink-500" : "text-gold",
          )}
          title={`${Math.round(lib.score * 100)}%`}
        >
          {t(exact ? "library.matchExact" : "library.matchClose")}
        </span>

        {next ? (
          <>
            <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink-300">
              {t("library.ep", { n: next.episode })}
            </span>
            <Button
              size="sm"
              className="shrink-0"
              onClick={() => playEpisode(lib.mediaId, next.episode)}
            >
              <Play className="size-3" fill="currentColor" />
              {t("library.play")}
            </Button>
          </>
        ) : (
          <span className="w-16 shrink-0 text-right text-2xs text-ink-600">
            {muted ? t("library.allWatched") : ""}
          </span>
        )}
      </div>

      {/* Every episode on disk, one click away. The design drops these for the
          next-file row, but playing something out of order is what this screen
          could already do and there is no reason to take it away. */}
      {open && (
        <div className="flex flex-wrap gap-1.5 border-t border-surface-950 px-3.5 py-2.5 pl-[3.9375rem]">
          {lib.files.map((file) => {
            const watched = file.episode <= entry.progress;
            return (
              <button
                key={file.episode}
                onClick={() => playEpisode(lib.mediaId, file.episode)}
                title={fileName(file.path)}
                aria-label={t("library.playEpisode", { n: file.episode })}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-surface",
                  watched
                    ? "bg-surface-800 text-ink-500 hover:text-ink-100"
                    : "bg-accent-600/15 text-accent-400 hover:bg-accent-600/30",
                )}
              >
                <Play className="size-2.5" fill="currentColor" />
                {file.episode}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
