import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Play, RefreshCw } from "lucide-react";
import { fetchMediaList } from "@/api/anilist";
import { displayTitle, type MediaListEntry } from "@/api/types";
import { scanLibrary } from "@/api/library";
import { useAuth } from "@/stores/auth";
import { useLibrary } from "@/stores/library";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked } from "@/lib/contentFilter";
import { Button } from "@/components/ui/button";
import { EmptyState, FolderStack } from "@/components/EmptyState";
import { cn } from "@/lib/utils";

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

  const rows = useMemo(
    () =>
      entries
        .filter((e) => byMedia.has(e.mediaId))
        .map((e) => ({ lib: e, entry: byMedia.get(e.mediaId) }))
        .sort((a, b) => {
          const at = a.entry ? displayTitle(a.entry.media.title) : "";
          const bt = b.entry ? displayTitle(b.entry.media.title) : "";
          return at.localeCompare(bt);
        }),
    [entries, byMedia],
  );

  const rescan = async () => {
    setScanning(true);
    try {
      await scanLibrary();
      await refresh();
    } catch {
      /* the folder may be unset — Settings owns that flow */
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-8 pt-6">
        <div>
          <h1 className="text-2xl font-bold">{t("library.title")}</h1>
          {rows.length > 0 && (
            <p className="mt-1 text-sm text-ink-500">
              {t("library.matched", { n: rows.length })}
            </p>
          )}
        </div>
        <Button variant="ghost" onClick={rescan} disabled={scanning}>
          <RefreshCw className={cn("size-3.75", scanning && "animate-spin")} />
          {scanning ? t("settings.libraryScanning") : t("settings.libraryScan")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
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
          <div className="grid gap-2 2xl:grid-cols-2">
            {rows.map(({ lib, entry }) => (
              <LibraryRow key={lib.mediaId} lib={lib} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LibraryRow({
  lib,
  entry,
}: {
  lib: { mediaId: number; episodes: number[] };
  entry: MediaListEntry | undefined;
}) {
  const { t } = useTranslation();
  const playEpisode = useLibrary((s) => s.playEpisode);
  const progress = entry?.progress ?? 0;
  const cover = entry?.media.coverImage.large;
  const title = entry ? displayTitle(entry.media.title) : `#${lib.mediaId}`;
  const total = entry?.media.episodes ?? null;

  return (
    <div className="flex gap-4 rounded-xl border border-hair bg-surface-900 p-3 panel-wash">
      <Link to={`/media/${lib.mediaId}`} className="shrink-0">
        <div className="h-24 w-16 overflow-hidden rounded-lg bg-surface-800">
          {cover && (
            <img
              src={cover}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}
        </div>
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          to={`/media/${lib.mediaId}`}
          className="text-sm font-semibold text-ink-100 hover:text-accent-400"
        >
          {title}
        </Link>
        <p className="mt-0.5 text-xs text-ink-600">
          {t("library.onDisk", { n: lib.episodes.length })}
          {total ? ` · ${t("library.watchedOf", { progress, total })}` : ""}
        </p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {lib.episodes.map((ep) => {
            const watched = ep <= progress;
            return (
              <button
                key={ep}
                onClick={() => playEpisode(lib.mediaId, ep)}
                title={t("library.playEpisode", { n: ep })}
                aria-label={t("library.playEpisode", { n: ep })}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  watched
                    ? "bg-surface-800 text-ink-500 hover:text-ink-100"
                    : "bg-accent-600/15 text-accent-400 hover:bg-accent-600/30",
                )}
              >
                <Play className="size-2.5" fill="currentColor" />
                {ep}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
