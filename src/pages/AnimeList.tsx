import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CloudOff,
  LayoutGrid,
  List as ListIcon,
  Pencil,
  Plus,
  RefreshCw,
  Search as SearchIcon,
  Star,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/stores/auth";
import { fetchAnimeList, flushQueue } from "@/api/anilist";
import {
  displayTitle,
  STATUS_ORDER,
  type MediaListEntry,
  type MediaListStatus,
} from "@/api/types";
import { useListMutations } from "@/hooks/useListMutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

type SortKey = "updated" | "title" | "score" | "progress";
const SORT_KEYS: SortKey[] = ["updated", "title", "score", "progress"];

export default function AnimeList() {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const loading = useAuth((s) => s.loading);

  if (loading) return null;

  if (!viewer) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="text-center">
          <p className="text-ink-500">{t("list.connectPrompt")}</p>
          <Link to="/settings">
            <Button className="mt-4">{t("list.toSettings")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  return <ListView userId={viewer.id} />;
}

function ListView({ userId }: { userId: number }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<MediaListStatus>("CURRENT");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [grid, setGrid] = useState(true);
  const [editing, setEditing] = useState<MediaListEntry | null>(null);

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["animeList", userId],
    queryFn: () => fetchAnimeList(userId),
  });
  const { save, remove } = useListMutations(userId);

  const byStatus = useMemo(() => {
    const map = new Map<MediaListStatus, MediaListEntry[]>();
    for (const status of STATUS_ORDER) map.set(status, []);
    for (const group of data?.lists ?? []) {
      if (group.isCustomList) continue;
      for (const entry of group.entries) {
        map.get(entry.status)?.push(entry);
      }
    }
    return map;
  }, [data]);

  const entries = useMemo(() => {
    let list = byStatus.get(tab) ?? [];
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      list = list.filter((e) => {
        const ti = e.media.title;
        return [ti.romaji, ti.english, ti.native, ...e.media.synonyms]
          .filter(Boolean)
          .some((s) => s!.toLowerCase().includes(q));
      });
    }
    return [...list].sort((a, b) => {
      switch (sort) {
        case "title":
          return displayTitle(a.media.title).localeCompare(
            displayTitle(b.media.title),
          );
        case "score":
          return b.score - a.score;
        case "progress":
          return b.progress - a.progress;
        default:
          return b.updatedAt - a.updatedAt;
      }
    });
  }, [byStatus, tab, filter, sort]);

  if (isLoading) {
    return <p className="p-8 text-ink-500">{t("list.loading")}</p>;
  }
  if (error) {
    return (
      <div className="p-8">
        <p className="text-red-300">
          {t("list.loadError", { message: String(error) })}
        </p>
        <Button className="mt-4" variant="secondary" onClick={() => refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  const plusOne = (entry: MediaListEntry) =>
    save.mutate({ mediaId: entry.mediaId, progress: entry.progress + 1 });

  return (
    <div className="flex h-full flex-col">
      {(data?.fromCache || (data?.pending ?? 0) > 0) && (
        <div className="flex items-center gap-3 border-b border-surface-800 bg-amber-950/40 px-8 py-2 text-xs text-amber-300">
          <CloudOff size={14} />
          {data?.fromCache
            ? t("list.offline")
            : t("list.pending", { count: data?.pending ?? 0 })}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-amber-300"
            onClick={async () => {
              await flushQueue().catch(() => {});
              refetch();
            }}
          >
            <RefreshCw size={13} /> {t("list.syncNow")}
          </Button>
        </div>
      )}

      <div className="space-y-4 px-8 pt-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("list.title")}</h1>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isRefetching}
            aria-label={t("common.reload")}
          >
            <RefreshCw size={16} className={cn(isRefetching && "animate-spin")} />
          </Button>
        </div>

        <div className="flex flex-wrap gap-1">
          {STATUS_ORDER.map((status) => {
            const count = byStatus.get(status)?.length ?? 0;
            return (
              <button
                key={status}
                onClick={() => setTab(status)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === status
                    ? "bg-accent-600 text-white"
                    : "text-ink-500 hover:bg-surface-800 hover:text-ink-100",
                )}
              >
                {t(`status.${status}`)}
                {count > 0 && (
                  <span className="ml-1.5 text-xs opacity-70">{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <SearchIcon
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-600"
            />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("list.filterPlaceholder")}
              className="pl-8"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-9 rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm text-ink-300 focus:border-accent-500 focus:outline-none"
          >
            {SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(`sort.${k}`)}
              </option>
            ))}
          </select>
          <div className="ml-auto flex rounded-lg border border-surface-700">
            <button
              onClick={() => setGrid(true)}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-l-lg",
                grid ? "bg-surface-700 text-ink-100" : "text-ink-600 hover:text-ink-300",
              )}
              aria-label={t("list.gridView")}
            >
              <LayoutGrid size={15} />
            </button>
            <button
              onClick={() => setGrid(false)}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-r-lg",
                !grid ? "bg-surface-700 text-ink-100" : "text-ink-600 hover:text-ink-300",
              )}
              aria-label={t("list.listView")}
            >
              <ListIcon size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {entries.length === 0 ? (
          <p className="text-sm text-ink-600">{t("list.empty")}</p>
        ) : grid ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
            {entries.map((entry) => (
              <GridCard
                key={entry.id}
                entry={entry}
                onPlusOne={() => plusOne(entry)}
                onEdit={() => setEditing(entry)}
              />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-surface-800 rounded-xl border border-surface-800">
            {entries.map((entry) => (
              <ListRow
                key={entry.id}
                entry={entry}
                onPlusOne={() => plusOne(entry)}
                onEdit={() => setEditing(entry)}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EditModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSave={(input) => {
            save.mutate(input);
            setEditing(null);
          }}
          onDelete={() => {
            remove.mutate(editing.id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

interface CardProps {
  entry: MediaListEntry;
  onPlusOne: () => void;
  onEdit: () => void;
}

function canIncrement(entry: MediaListEntry) {
  return entry.media.episodes === null || entry.progress < entry.media.episodes;
}

function GridCard({ entry, onPlusOne, onEdit }: CardProps) {
  const { t } = useTranslation();
  const { media } = entry;
  const pct = media.episodes ? (entry.progress / media.episodes) * 100 : 0;
  return (
    <div className="group">
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-800">
        <Link to={`/anime/${media.id}`}>
          {media.coverImage.large && (
            <img
              src={media.coverImage.large}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}
        </Link>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={onEdit}
            className="grid h-8 w-8 place-items-center rounded-full bg-surface-900/90 text-ink-300 hover:bg-surface-800 hover:text-ink-100"
            aria-label={t("common.edit")}
          >
            <Pencil size={14} />
          </button>
          {canIncrement(entry) && (
            <button
              onClick={onPlusOne}
              className="grid h-8 w-8 place-items-center rounded-full bg-accent-600 text-white hover:bg-accent-500"
              aria-label={t("common.plusOne")}
            >
              <Plus size={16} />
            </button>
          )}
        </div>
        {entry.score > 0 && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-amber-300">
            <Star size={11} fill="currentColor" /> {entry.score}
          </span>
        )}
        {media.episodes !== null && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div
              className="h-full bg-accent-500"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        )}
      </div>
      <Link to={`/anime/${media.id}`}>
        <p className="mt-2 line-clamp-2 text-xs font-medium text-ink-300 group-hover:text-ink-100">
          {displayTitle(media.title)}
        </p>
      </Link>
      <p className="text-xs text-ink-600">
        {entry.progress}
        {media.episodes ? ` / ${media.episodes}` : ""} {t("common.episodes")}
      </p>
    </div>
  );
}

function ListRow({ entry, onPlusOne, onEdit }: CardProps) {
  const { t } = useTranslation();
  const { media } = entry;
  return (
    <div className="flex items-center gap-4 bg-surface-900 px-4 py-2.5 first:rounded-t-xl last:rounded-b-xl hover:bg-surface-850">
      <Link to={`/anime/${media.id}`} className="shrink-0">
        <img
          src={media.coverImage.large ?? ""}
          alt=""
          loading="lazy"
          className="h-14 w-10 rounded object-cover"
        />
      </Link>
      <Link to={`/anime/${media.id}`} className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-100">
          {displayTitle(media.title)}
        </p>
        <p className="text-xs text-ink-600">
          {media.format ?? ""}
          {media.seasonYear ? ` · ${media.seasonYear}` : ""}
        </p>
      </Link>
      <span className="flex w-16 items-center gap-1 text-sm text-amber-300">
        {entry.score > 0 && (
          <>
            <Star size={13} fill="currentColor" /> {entry.score}
          </>
        )}
      </span>
      <span className="w-24 text-right text-sm tabular-nums text-ink-300">
        {entry.progress}
        {media.episodes ? ` / ${media.episodes}` : ""}
      </span>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={onEdit}
          aria-label={t("common.edit")}
        >
          <Pencil size={14} />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          onClick={onPlusOne}
          disabled={!canIncrement(entry)}
          aria-label={t("common.plusOne")}
        >
          <Plus size={15} />
        </Button>
      </div>
    </div>
  );
}

function EditModal({
  entry,
  onClose,
  onSave,
  onDelete,
}: {
  entry: MediaListEntry;
  onClose: () => void;
  onSave: (input: {
    mediaId: number;
    status: MediaListStatus;
    progress: number;
    score: number;
  }) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MediaListStatus>(entry.status);
  const [progress, setProgress] = useState(entry.progress);
  const [score, setScore] = useState(entry.score);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const max = entry.media.episodes ?? 9999;

  return (
    <Modal title={displayTitle(entry.media.title)} onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-ink-500">{t("common.status")}</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as MediaListStatus)}
            className="h-9 w-full rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm focus:border-accent-500 focus:outline-none"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-ink-500">
              {entry.media.episodes
                ? t("list.progressMax", { max })
                : t("common.progress")}
            </span>
            <Input
              type="number"
              min={0}
              max={max}
              value={progress}
              onChange={(e) =>
                setProgress(Math.max(0, Math.min(max, Number(e.target.value))))
              }
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-ink-500">
              {t("list.scoreRange")}
            </span>
            <Input
              type="number"
              min={0}
              max={10}
              value={score}
              onChange={(e) =>
                setScore(Math.max(0, Math.min(10, Number(e.target.value))))
              }
            />
          </label>
        </div>
        <div className="flex items-center justify-between pt-2">
          {confirmDelete ? (
            <Button variant="danger" size="sm" onClick={onDelete}>
              {t("common.confirmRemove")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-red-400"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={14} /> {t("common.remove")}
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() =>
                onSave({ mediaId: entry.mediaId, status, progress, score })
              }
            >
              {t("common.save")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
