import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  CheckCheck,
  CheckSquare,
  CloudOff,
  Dices,
  LayoutGrid,
  List as ListIcon,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search as SearchIcon,
  Square,
  Star,
  Trash2,
  X,
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
import { collectTags, tagsOf } from "@/lib/tags";
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
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [grid, setGrid] = useState(true);
  const [editing, setEditing] = useState<MediaListEntry | null>(null);
  const [showRandom, setShowRandom] = useState(false);
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets(type));
  const [showPresetSave, setShowPresetSave] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Clear the selection whenever the pool it refers to changes.
  useEffect(() => setSelected(new Set()), [tab]);

  const toggleSelect = (mediaId: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });

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

  // Union of tags across the whole list, for the filter + editor autocomplete.
  const allTags = useMemo(
    () =>
      collectTags(
        [...byStatus.values()].flat().map((e) => e.notes),
      ),
    [byStatus],
  );

  // A tag that no longer exists anywhere must not keep the list empty.
  useEffect(() => {
    if (tagFilter && !allTags.some((x) => x.toLowerCase() === tagFilter.toLowerCase()))
      setTagFilter("");
  }, [allTags, tagFilter]);

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
    if (tagFilter) {
      const q = tagFilter.toLowerCase();
      list = list.filter((e) =>
        tagsOf(e.notes).some((x) => x.toLowerCase() === q),
      );
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
  }, [byStatus, tab, filter, tagFilter, sort]);

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

  const selectedEntries = entries.filter((e) => selected.has(e.mediaId));
  const bulkStatus = (status: MediaListStatus) =>
    selectedEntries.forEach((e) => save.mutate({ mediaId: e.mediaId, status }));
  const bulkScore = (score: number) =>
    selectedEntries.forEach((e) => save.mutate({ mediaId: e.mediaId, score }));
  const bulkDelete = () => {
    selectedEntries.forEach((e) => remove.mutate(e.id));
    setSelected(new Set());
  };
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
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
          <div className="flex items-center gap-1">
            <Button
              variant={selectMode ? "secondary" : "ghost"}
              size="icon"
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              aria-label={t("bulk.select")}
              title={t("bulk.select")}
            >
              <CheckSquare size={16} />
            </Button>
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
          {allTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="h-9 max-w-32 rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm text-ink-300 focus:border-accent-500 focus:outline-none"
              aria-label={t("tags.filter")}
            >
              <option value="">{t("tags.allTags")}</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          )}
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
                selectMode={selectMode}
                selected={selected.has(entry.mediaId)}
                onToggleSelect={() => toggleSelect(entry.mediaId)}
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
                selectMode={selectMode}
                selected={selected.has(entry.mediaId)}
                onToggleSelect={() => toggleSelect(entry.mediaId)}
              />
            ))}
          </div>
        )}
      </div>

      {selectMode && (
        <BulkBar
          type={type}
          count={selected.size}
          onStatus={bulkStatus}
          onScore={bulkScore}
          onDelete={bulkDelete}
          onClear={exitSelect}
        />
      )}

      {editing && (
        <EntryEditModal
          media={{ ...editing.media, type }}
          entry={editing}
          tagSuggestions={allTags}
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

/** Sticky action bar for bulk edits over the current selection. */
function BulkBar({
  type,
  count,
  onStatus,
  onScore,
  onDelete,
  onClear,
}: {
  type: MediaType;
  count: number;
  onStatus: (s: MediaListStatus) => void;
  onScore: (n: number) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const disabled = count === 0;

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-surface-700 bg-surface-900 px-8 py-3">
      <span className="text-sm font-medium text-ink-100">
        {t("bulk.selected", { count })}
      </span>

      <select
        value=""
        disabled={disabled}
        onChange={(e) => e.target.value && onStatus(e.target.value as MediaListStatus)}
        className="h-9 rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm text-ink-300 focus:border-accent-500 focus:outline-none disabled:opacity-50"
        aria-label={t("bulk.setStatus")}
      >
        <option value="">{t("bulk.setStatus")}</option>
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {t(`status.${type}.${s}`)}
          </option>
        ))}
      </select>

      <select
        value=""
        disabled={disabled}
        onChange={(e) => e.target.value !== "" && onScore(Number(e.target.value))}
        className="h-9 rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm text-amber-300 focus:border-accent-500 focus:outline-none disabled:opacity-50"
        aria-label={t("bulk.setScore")}
      >
        <option value="">{t("bulk.setScore")}</option>
        <option value={0}>–</option>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            ★ {n}
          </option>
        ))}
      </select>

      {confirmDelete ? (
        <Button variant="danger" size="sm" disabled={disabled} onClick={onDelete}>
          {t("bulk.confirmDelete", { count })}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="text-red-400"
          disabled={disabled}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 size={14} /> {t("common.remove")}
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={onClear}
      >
        <X size={14} /> {t("bulk.done")}
      </Button>
    </div>
  );
}

/** Selection checkbox shared by the grid and list rows. */
function SelectBox({
  checked,
  onToggle,
  className,
}: {
  checked: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onToggle}
      className={cn(
        "grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors",
        checked
          ? "border-accent-500 bg-accent-600 text-white"
          : "border-surface-600 bg-surface-900/80 text-transparent hover:border-accent-500",
        className,
      )}
      role="checkbox"
      aria-checked={checked}
      aria-label={t("bulk.select")}
    >
      {checked ? <CheckSquare size={14} /> : <Square size={14} />}
    </button>
  );
}

function GridCard({
  entry,
  unit,
  onPlusOne,
  onComplete,
  onEdit,
  selectMode,
  selected,
  onToggleSelect,
}: {
  entry: MediaListEntry;
  unit: string;
  onPlusOne: () => void;
  onComplete: () => void;
  onEdit: () => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const { t } = useTranslation();
  const { media } = entry;
  const max = maxProgress(media);
  const pct = max ? (entry.progress / max) * 100 : 0;
  return (
    <div className="group">
      <div
        className={cn(
          "relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-800",
          selected && "ring-2 ring-accent-500",
        )}
      >
        {selectMode ? (
          <button
            onClick={onToggleSelect}
            className="absolute inset-0 z-10 bg-black/30"
            aria-label={t("bulk.select")}
          >
            {media.coverImage.large && (
              <img
                src={media.coverImage.large}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            )}
          </button>
        ) : (
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
        )}
        {selectMode && (
          <SelectBox
            checked={selected}
            onToggle={onToggleSelect}
            className="absolute left-2 top-2 z-20"
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <div
          className={cn(
            "absolute bottom-2 right-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100",
            selectMode && "hidden",
          )}
        >
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
      <TagChips notes={entry.notes} />
    </div>
  );
}

/** Read-only tag chips derived from an entry's notes (capped for layout). */
function TagChips({ notes, max = 3 }: { notes: string | null; max?: number }) {
  const tags = tagsOf(notes);
  if (tags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tags.slice(0, max).map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-surface-800 px-1.5 py-0.5 text-[10px] text-accent-300"
        >
          {tag}
        </span>
      ))}
      {tags.length > max && (
        <span className="text-[10px] text-ink-600">+{tags.length - max}</span>
      )}
    </div>
  );
}

function ListRow({
  entry,
  onQuickSave,
  onComplete,
  onEdit,
  selectMode,
  selected,
  onToggleSelect,
}: {
  entry: MediaListEntry;
  onQuickSave: (patch: { progress?: number; score?: number }) => void;
  onComplete: () => void;
  onEdit: () => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const { t } = useTranslation();
  const { media } = entry;
  const max = maxProgress(media);
  const dropdown = max !== null && max <= PROGRESS_DROPDOWN_LIMIT;
  const hasNext = useLibrary((s) => s.hasNext);
  const play = useLibrary((s) => s.play);
  const canPlayNext =
    !selectMode && media.type === "ANIME" && hasNext(media.id, entry.progress);

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 first:rounded-t-xl last:rounded-b-xl",
        selected ? "bg-accent-600/10" : "bg-surface-900 hover:bg-surface-850",
      )}
    >
      {selectMode && (
        <SelectBox checked={selected} onToggle={onToggleSelect} />
      )}
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
        <TagChips notes={entry.notes} max={4} />
      </Link>

      {selectMode ? null : (
        <>
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
        </>
      )}
    </div>
  );
}
