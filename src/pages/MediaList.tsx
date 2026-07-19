import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  CheckCheck,
  CloudOff,
  Dices,
  LayoutGrid,
  List as ListIcon,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search as SearchIcon,
  Star,
} from "lucide-react";
import { useAuth } from "@/stores/auth";
import { useLibrary } from "@/stores/library";
import { fetchMediaList, flushQueue } from "@/api/anilist";
import {
  displayTitle,
  maxProgress,
  STATUS_ORDER,
  type MediaListEntry,
  type MediaListStatus,
  type MediaType,
} from "@/api/types";
import { useListMutations } from "@/hooks/useListMutations";
import EntryEditModal from "@/components/EntryEditModal";
import RandomPickModal from "@/components/RandomPickModal";
import PresetModal from "@/components/PresetModal";
import { loadPresets, savePresets, type Preset } from "@/lib/presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SortKey = "updated" | "title" | "score" | "progress";
const SORT_KEYS: SortKey[] = ["updated", "title", "score", "progress"];

// Progress dropdowns only up to this length (long-runners like One Piece
// keep +1/modal instead of a 1000-entry dropdown)
const PROGRESS_DROPDOWN_LIMIT = 600;

export default function MediaList({ type }: { type: MediaType }) {
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

  return <ListView userId={viewer.id} type={type} />;
}

function ListView({ userId, type }: { userId: number; type: MediaType }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<MediaListStatus>("CURRENT");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [grid, setGrid] = useState(true);
  const [editing, setEditing] = useState<MediaListEntry | null>(null);
  const [showRandom, setShowRandom] = useState(false);
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets(type));
  const [showPresetSave, setShowPresetSave] = useState(false);

  const applyPreset = (name: string) => {
    const p = presets.find((x) => x.name === name);
    if (!p) return;
    setTab(p.tab as MediaListStatus);
    setFilter(p.filter);
    setSort(p.sort as SortKey);
  };

  const addPreset = (name: string) => {
    const next = [
      ...presets.filter((p) => p.name !== name),
      { name, tab, filter, sort },
    ];
    setPresets(next);
    savePresets(type, next);
  };

  const deletePreset = (name: string) => {
    const next = presets.filter((p) => p.name !== name);
    setPresets(next);
    savePresets(type, next);
  };

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["mediaList", type, userId],
    queryFn: () => fetchMediaList(userId, type),
  });
  const { save, remove } = useListMutations(userId, type);

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

  const quickSave = (
    entry: MediaListEntry,
    patch: Partial<{ progress: number; score: number; status: MediaListStatus }>,
  ) => save.mutate({ mediaId: entry.mediaId, ...patch });

  const complete = (entry: MediaListEntry) => {
    const max = maxProgress(entry.media);
    quickSave(entry, {
      status: "COMPLETED",
      ...(max !== null ? { progress: max } : {}),
    });
  };

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
          <h1 className="text-2xl font-bold">
            {type === "ANIME" ? t("list.animeTitle") : t("list.mangaTitle")}
          </h1>
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
                {t(`status.${type}.${status}`)}
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
          {presets.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && applyPreset(e.target.value)}
              className="h-9 max-w-32 rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm text-ink-300 focus:border-accent-500 focus:outline-none"
              aria-label={t("presets.apply")}
            >
              <option value="">{t("presets.apply")}</option>
              {presets.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setShowPresetSave(true)}
            aria-label={t("presets.save")}
            title={t("presets.save")}
          >
            <Bookmark size={16} />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setShowRandom(true)}
            aria-label={t("random.pick")}
            title={t("random.pick")}
          >
            <Dices size={16} />
          </Button>
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
                unit={type === "ANIME" ? t("common.episodes") : t("common.chapters")}
                onPlusOne={() =>
                  quickSave(entry, { progress: entry.progress + 1 })
                }
                onComplete={() => complete(entry)}
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
                onQuickSave={(patch) => quickSave(entry, patch)}
                onComplete={() => complete(entry)}
                onEdit={() => setEditing(entry)}
              />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EntryEditModal
          media={{ ...editing.media, type }}
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

      {showRandom && (
        <RandomPickModal
          pool={byStatus.get("PLANNING") ?? []}
          onClose={() => setShowRandom(false)}
        />
      )}

      {showPresetSave && (
        <PresetModal
          presets={presets}
          onSave={addPreset}
          onDelete={deletePreset}
          onClose={() => setShowPresetSave(false)}
        />
      )}
    </div>
  );
}

function canIncrement(entry: MediaListEntry) {
  const max = maxProgress(entry.media);
  return max === null || entry.progress < max;
}

function GridCard({
  entry,
  unit,
  onPlusOne,
  onComplete,
  onEdit,
}: {
  entry: MediaListEntry;
  unit: string;
  onPlusOne: () => void;
  onComplete: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const { media } = entry;
  const max = maxProgress(media);
  const pct = max ? (entry.progress / max) * 100 : 0;
  return (
    <div className="group">
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-800">
        <Link to={`/media/${media.id}`}>
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
            title={t("common.edit")}
          >
            <Pencil size={14} />
          </button>
          {entry.status !== "COMPLETED" && (
            <button
              onClick={onComplete}
              className="grid h-8 w-8 place-items-center rounded-full bg-emerald-700/90 text-white hover:bg-emerald-600"
              aria-label={t("common.complete")}
              title={t("common.complete")}
            >
              <CheckCheck size={14} />
            </button>
          )}
          {canIncrement(entry) && (
            <button
              onClick={onPlusOne}
              className="grid h-8 w-8 place-items-center rounded-full bg-accent-600 text-white hover:bg-accent-500"
              aria-label={t("common.plusOne")}
              title={t("common.plusOne")}
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
        {max !== null && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div
              className="h-full bg-accent-500"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        )}
      </div>
      <Link to={`/media/${media.id}`}>
        <p className="mt-2 line-clamp-2 text-xs font-medium text-ink-300 group-hover:text-ink-100">
          {displayTitle(media.title)}
        </p>
      </Link>
      <p className="text-xs text-ink-600">
        {entry.progress}
        {max ? ` / ${max}` : ""} {unit}
      </p>
    </div>
  );
}

function ListRow({
  entry,
  onQuickSave,
  onComplete,
  onEdit,
}: {
  entry: MediaListEntry;
  onQuickSave: (patch: { progress?: number; score?: number }) => void;
  onComplete: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const { media } = entry;
  const max = maxProgress(media);
  const dropdown = max !== null && max <= PROGRESS_DROPDOWN_LIMIT;
  const hasNext = useLibrary((s) => s.hasNext);
  const play = useLibrary((s) => s.play);
  const canPlayNext = media.type === "ANIME" && hasNext(media.id, entry.progress);

  return (
    <div className="flex items-center gap-3 bg-surface-900 px-4 py-2.5 first:rounded-t-xl last:rounded-b-xl hover:bg-surface-850">
      <Link to={`/media/${media.id}`} className="shrink-0">
        <img
          src={media.coverImage.large ?? ""}
          alt=""
          loading="lazy"
          className="h-14 w-10 rounded object-cover"
        />
      </Link>
      <Link to={`/media/${media.id}`} className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-100">
          {displayTitle(media.title)}
        </p>
        <p className="text-xs text-ink-600">
          {media.format ?? ""}
          {media.seasonYear ? ` · ${media.seasonYear}` : ""}
        </p>
      </Link>

      {/* Quick score */}
      <select
        value={entry.score}
        onChange={(e) => onQuickSave({ score: Number(e.target.value) })}
        className="h-8 rounded-lg border border-surface-700 bg-surface-900 px-1.5 text-sm text-amber-300 focus:border-accent-500 focus:outline-none"
        aria-label={t("common.score")}
        title={t("common.score")}
      >
        <option value={0}>–</option>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            ★ {n}
          </option>
        ))}
      </select>

      {/* Quick progress */}
      {dropdown ? (
        <select
          value={entry.progress}
          onChange={(e) => onQuickSave({ progress: Number(e.target.value) })}
          className="h-8 w-24 rounded-lg border border-surface-700 bg-surface-900 px-1.5 text-sm tabular-nums text-ink-300 focus:border-accent-500 focus:outline-none"
          aria-label={t("common.progress")}
          title={t("common.progress")}
        >
          {Array.from({ length: max + 1 }, (_, n) => (
            <option key={n} value={n}>
              {n} / {max}
            </option>
          ))}
        </select>
      ) : (
        <span className="w-24 text-right text-sm tabular-nums text-ink-300">
          {entry.progress}
          {max ? ` / ${max}` : ""}
        </span>
      )}

      <div className="flex gap-1">
        {canPlayNext && (
          <Button
            variant="ghost"
            size="icon"
            className="text-accent-400"
            onClick={() => play(media.id).catch(() => {})}
            aria-label={t("common.playNext")}
            title={t("common.playNext")}
          >
            <Play size={15} />
          </Button>
        )}
        <Button
          variant="secondary"
          size="icon"
          onClick={() => onQuickSave({ progress: entry.progress + 1 })}
          disabled={!canIncrement(entry)}
          aria-label={t("common.plusOne")}
          title={t("common.plusOne")}
        >
          <Plus size={15} />
        </Button>
        {entry.status !== "COMPLETED" && (
          <Button
            variant="ghost"
            size="icon"
            className="text-emerald-400"
            onClick={onComplete}
            aria-label={t("common.complete")}
            title={t("common.complete")}
          >
            <CheckCheck size={15} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onEdit}
          aria-label={t("common.edit")}
          title={t("common.edit")}
        >
          <Pencil size={14} />
        </Button>
      </div>
    </div>
  );
}
