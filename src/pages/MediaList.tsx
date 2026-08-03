import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link } from "react-router";
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
import { useTheme } from "@/stores/theme";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked } from "@/lib/contentFilter";
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
import { searchHaystack } from "@/lib/search";
import { useColumnCount } from "@/hooks/useColumnCount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SortKey = "updated" | "title" | "score" | "progress";
const SORT_KEYS: SortKey[] = ["updated", "title", "score", "progress"];

// Progress dropdowns only up to this length (long-runners like One Piece
// keep +1/modal instead of a 1000-entry dropdown)
const PROGRESS_DROPDOWN_LIMIT = 600;

// `String.localeCompare` builds a fresh collator on every call, which a sort
// over a few thousand titles pays for n·log n times. Options are deliberately
// left at the defaults so the ordering matches what `localeCompare()` gave.
const COLLATOR = new Intl.Collator();

export default function MediaList({ type }: { type: MediaType }) {
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
          <Link to="/settings">
            <Button className="mt-4">{t("list.toSettings")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Local mode has no AniList user id; 0 is a stable local-list key.
  return <ListView userId={viewer?.id ?? 0} type={type} />;
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
  const scrollRef = useRef<HTMLDivElement>(null);

  // Clear the selection whenever the pool it refers to changes.
  useEffect(() => setSelected(new Set()), [tab]);

  const toggleSelect = useCallback((mediaId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });
  }, []);

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

  const level = useContentFilter((s) => s.level);

  // The content filter is applied here rather than further down, so every
  // consumer of byStatus — the tabs, the random pick, the tag union — is
  // covered by one check instead of each remembering to repeat it.
  //
  // Deliberately not applied at the cache layer: that same cache feeds the
  // scrobbler and the library matcher, which must keep recognising every
  // title the user actually tracks.
  const byStatus = useMemo(() => {
    const map = new Map<MediaListStatus, MediaListEntry[]>();
    for (const status of STATUS_ORDER) map.set(status, []);
    for (const group of data?.lists ?? []) {
      if (group.isCustomList) continue;
      for (const entry of group.entries) {
        if (isBlocked(entry.media, level)) continue;
        map.get(entry.status)?.push(entry);
      }
    }
    return map;
  }, [data, level]);

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

  /**
   * Search and sort keys, derived once per list change instead of once per
   * entry per keystroke. Filtering used to lowercase four titles plus every
   * synonym for every entry on each character typed, and sorting by title
   * re-derived the display title on each of the n·log n comparisons.
   */
  const searchKeys = useMemo(() => {
    const map = new Map<
      number,
      { haystack: string; tags: string[]; title: string }
    >();
    for (const list of byStatus.values()) {
      for (const e of list) {
        map.set(e.id, {
          haystack: searchHaystack(e.media),
          tags: tagsOf(e.notes).map((x) => x.toLowerCase()),
          title: displayTitle(e.media.title),
        });
      }
    }
    return map;
  }, [byStatus]);

  // Keeps the text field responsive: React renders the (possibly huge) filtered
  // list at a lower priority while the input echoes the keystroke immediately.
  const deferredFilter = useDeferredValue(filter);

  const entries = useMemo(() => {
    let list = byStatus.get(tab) ?? [];
    const q = deferredFilter.trim().toLowerCase();
    if (q) {
      list = list.filter((e) => searchKeys.get(e.id)?.haystack.includes(q));
    }
    if (tagFilter) {
      const tag = tagFilter.toLowerCase();
      list = list.filter((e) => searchKeys.get(e.id)?.tags.includes(tag));
    }
    return [...list].sort((a, b) => {
      switch (sort) {
        case "title":
          return COLLATOR.compare(
            searchKeys.get(a.id)?.title ?? "",
            searchKeys.get(b.id)?.title ?? "",
          );
        case "score":
          return b.score - a.score;
        case "progress":
          return b.progress - a.progress;
        default:
          return b.updatedAt - a.updatedAt;
      }
    });
  }, [byStatus, tab, deferredFilter, tagFilter, sort, searchKeys]);

  // Everything below must stay *above* the early returns: hooks after a
  // conditional return blow up on the loading → loaded transition. They are
  // memoized so the memoized cards below don't re-render on every keystroke.
  //
  // `mutate` is referentially stable across renders; the mutation object it
  // hangs off is not, so depend on the function itself.
  const { mutate: saveMutate } = save;

  const quickSave = useCallback(
    (
      entry: MediaListEntry,
      patch: Partial<{ progress: number; score: number; status: MediaListStatus }>,
    ) => saveMutate({ mediaId: entry.mediaId, ...patch }),
    [saveMutate],
  );

  const complete = useCallback(
    (entry: MediaListEntry) => {
      const max = maxProgress(entry.media);
      quickSave(entry, {
        status: "COMPLETED",
        ...(max !== null ? { progress: max } : {}),
      });
    },
    [quickSave],
  );

  const plusOne = useCallback(
    (entry: MediaListEntry) =>
      quickSave(entry, { progress: entry.progress + 1 }),
    [quickSave],
  );

  const startEdit = useCallback((entry: MediaListEntry) => setEditing(entry), []);

  const selectedEntries = useMemo(
    () => entries.filter((e) => selected.has(e.mediaId)),
    [entries, selected],
  );

  const unit = type === "ANIME" ? t("common.episodes") : t("common.chapters");

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

  const bulkStatus = (status: MediaListStatus) =>
    selectedEntries.forEach((e) => saveMutate({ mediaId: e.mediaId, status }));
  const bulkScore = (score: number) =>
    selectedEntries.forEach((e) => saveMutate({ mediaId: e.mediaId, score }));
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
        <div className="flex items-center gap-3 border-b border-surface-800 bg-amber-950/40 px-8 py-2 text-xs text-gold">
          <CloudOff className="size-3.5" />
          {data?.fromCache
            ? t("list.offline")
            : t("list.pending", { count: data?.pending ?? 0 })}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-gold"
            onClick={async () => {
              await flushQueue().catch(() => {});
              refetch();
            }}
          >
            <RefreshCw className="size-3.25" /> {t("list.syncNow")}
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
              <CheckSquare className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              disabled={isRefetching}
              aria-label={t("common.reload")}
            >
              <RefreshCw className={cn("size-4", isRefetching && "animate-spin")} />
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
                    ? "bg-accent-600 text-accent-ink"
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
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-600"
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
            <Bookmark className="size-4" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => setShowRandom(true)}
            aria-label={t("random.pick")}
            title={t("random.pick")}
          >
            <Dices className="size-4" />
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
              <LayoutGrid className="size-3.75" />
            </button>
            <button
              onClick={() => setGrid(false)}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-r-lg",
                !grid ? "bg-surface-700 text-ink-100" : "text-ink-600 hover:text-ink-300",
              )}
              aria-label={t("list.listView")}
            >
              <ListIcon className="size-3.75" />
            </button>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {entries.length === 0 ? (
          <p className="text-sm text-ink-600">{t("list.empty")}</p>
        ) : grid ? (
          <VirtualGrid
            items={entries}
            scrollRef={scrollRef}
            gridClassName="media-grid gap-x-4"
            rowGap={24}
            estimateRowHeight={300}
            renderItem={(entry) => (
              <GridCard
                key={entry.id}
                entry={entry}
                unit={unit}
                onPlusOne={plusOne}
                onComplete={complete}
                onEdit={startEdit}
                selectMode={selectMode}
                selected={selected.has(entry.mediaId)}
                onToggleSelect={toggleSelect}
              />
            )}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-surface-800 bg-surface-800">
            <VirtualGrid
              items={entries}
              scrollRef={scrollRef}
              gridClassName="grid gap-px 2xl:grid-cols-2"
              rowGap={1}
              estimateRowHeight={78}
              renderItem={(entry) => (
                <ListRow
                  key={entry.id}
                  entry={entry}
                  onQuickSave={quickSave}
                  onComplete={complete}
                  onEdit={startEdit}
                  selectMode={selectMode}
                  selected={selected.has(entry.mediaId)}
                  onToggleSelect={toggleSelect}
                />
              )}
            />
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

/**
 * A CSS grid whose rows are virtualized: only the rows near the viewport are
 * mounted. A completed list can run to several thousand entries, and mounting
 * every cover at once is what made switching to this page stutter.
 *
 * Rows are chunked by hand, so the number of columns has to be known — see
 * `useColumnCount` for why it is measured rather than computed. The probe is a
 * zero-height copy of the grid: `auto-fill` resolves its full track list even
 * with no children, which gives a column count on the very first render and
 * keeps one source of truth for the layout in `index.css`.
 *
 * `rowGap` is applied as padding rather than `gap-y` because each row is now
 * its own grid — a gap between the rows of *different* grids does nothing. As
 * padding it lands inside the border box, so `measureElement` counts it.
 */
function VirtualGrid({
  items,
  scrollRef,
  gridClassName,
  rowGap,
  estimateRowHeight,
  renderItem,
}: {
  items: MediaListEntry[];
  scrollRef: RefObject<HTMLDivElement | null>;
  gridClassName: string;
  rowGap: number;
  estimateRowHeight: number;
  renderItem: (entry: MediaListEntry) => ReactNode;
}) {
  const probeRef = useRef<HTMLDivElement>(null);
  // Density moves the grid track without changing the probe's own size, so the
  // ResizeObserver inside the hook never fires for it — see `watch` there.
  const density = useTheme((s) => s.density);
  const columns = useColumnCount(probeRef, density);
  const rowCount = Math.ceil(items.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 4,
  });

  // Titles wrap differently at a different column count, so the cached row
  // measurements are worthless once it changes.
  useEffect(() => {
    virtualizer.measure();
  }, [columns, virtualizer]);

  return (
    <>
      <div ref={probeRef} className={cn(gridClassName, "h-0")} aria-hidden />
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className={cn(gridClassName, "absolute left-0 top-0 w-full")}
            style={{
              transform: `translateY(${row.start}px)`,
              paddingBottom: rowGap,
            }}
          >
            {items
              .slice(row.index * columns, row.index * columns + columns)
              .map(renderItem)}
          </div>
        ))}
      </div>
    </>
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
        className="h-9 rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm text-gold focus:border-accent-500 focus:outline-none disabled:opacity-50"
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
          <Trash2 className="size-3.5" /> {t("common.remove")}
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={onClear}
      >
        <X className="size-3.5" /> {t("bulk.done")}
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
          ? "border-accent-500 bg-accent-600 text-accent-ink"
          : "border-surface-600 bg-surface-900/80 text-transparent hover:border-accent-500",
        className,
      )}
      role="checkbox"
      aria-checked={checked}
      aria-label={t("bulk.select")}
    >
      {checked ? <CheckSquare className="size-3.5" /> : <Square className="size-3.5" />}
    </button>
  );
}

/**
 * Memoized: a list of a few hundred cards re-rendered on every keystroke or
 * +1 is the single biggest cost on this page. The handlers take the entry
 * rather than closing over it so the props stay referentially stable.
 */
const GridCard = memo(function GridCard({
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
  onPlusOne: (entry: MediaListEntry) => void;
  onComplete: (entry: MediaListEntry) => void;
  onEdit: (entry: MediaListEntry) => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (mediaId: number) => void;
}) {
  const { t } = useTranslation();
  const { media } = entry;
  const max = maxProgress(media);
  const pct = max ? (entry.progress / max) * 100 : 0;
  return (
    <div className="group" data-media-id={media.id} data-media-type={media.type}>
      <div
        className={cn(
          "relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-800",
          selected && "ring-2 ring-accent-500",
        )}
      >
        {selectMode ? (
          <button
            onClick={() => onToggleSelect(entry.mediaId)}
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
            onToggle={() => onToggleSelect(entry.mediaId)}
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
            onClick={() => onEdit(entry)}
            className="grid h-8 w-8 place-items-center rounded-full bg-surface-900/90 text-ink-300 hover:bg-surface-800 hover:text-ink-100"
            aria-label={t("common.edit")}
            title={t("common.edit")}
          >
            <Pencil className="size-3.5" />
          </button>
          {entry.status !== "COMPLETED" && (
            <button
              onClick={() => onComplete(entry)}
              className="grid h-8 w-8 place-items-center rounded-full bg-emerald-700/90 text-white hover:bg-emerald-600"
              aria-label={t("common.complete")}
              title={t("common.complete")}
            >
              <CheckCheck className="size-3.5" />
            </button>
          )}
          {canIncrement(entry) && (
            <button
              onClick={() => onPlusOne(entry)}
              className="grid h-8 w-8 place-items-center rounded-full bg-accent-600 text-accent-ink hover:bg-accent-500"
              aria-label={t("common.plusOne")}
              title={t("common.plusOne")}
            >
              <Plus className="size-4" />
            </button>
          )}
        </div>
        {entry.score > 0 && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-gold">
            <Star className="size-2.75" fill="currentColor" /> {entry.score}
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
});

/** Read-only tag chips derived from an entry's notes (capped for layout). */
function TagChips({ notes, max = 3 }: { notes: string | null; max?: number }) {
  const tags = tagsOf(notes);
  if (tags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tags.slice(0, max).map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-surface-800 px-1.5 py-0.5 text-2xs text-accent-300"
        >
          {tag}
        </span>
      ))}
      {tags.length > max && (
        <span className="text-2xs text-ink-600">+{tags.length - max}</span>
      )}
    </div>
  );
}

/** Memoized for the same reason as GridCard — see the note there. */
const ListRow = memo(function ListRow({
  entry,
  onQuickSave,
  onComplete,
  onEdit,
  selectMode,
  selected,
  onToggleSelect,
}: {
  entry: MediaListEntry;
  onQuickSave: (
    entry: MediaListEntry,
    patch: { progress?: number; score?: number },
  ) => void;
  onComplete: (entry: MediaListEntry) => void;
  onEdit: (entry: MediaListEntry) => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (mediaId: number) => void;
}) {
  const { t } = useTranslation();
  const { media } = entry;
  const max = maxProgress(media);
  const dropdown = max !== null && max <= PROGRESS_DROPDOWN_LIMIT;
  // Subscribe to the *data*, not to `hasNext`. The selector used to return the
  // store's `hasNext` function, whose identity never changes — so the row never
  // re-rendered after a library scan and the play button stayed missing until
  // something else happened to re-render the list.
  const episodes = useLibrary((s) => s.episodes[media.id]);
  const play = useLibrary((s) => s.play);
  const canPlayNext =
    !selectMode &&
    media.type === "ANIME" &&
    !!episodes?.some((e) => e > entry.progress);

  // The progress dropdown can hold up to PROGRESS_DROPDOWN_LIMIT options. Only
  // one of them is visible before the user opens it, so mount the rest on first
  // interaction. Hover fires well ahead of the click; focus/mousedown are the
  // keyboard and fast-click fallbacks.
  const [progressOpened, setProgressOpened] = useState(false);
  const openProgress = () => setProgressOpened(true);

  return (
    <div
      data-media-id={media.id}
      data-media-type={media.type}
      className={cn(
        "flex items-center gap-3 px-4 py-2.5",
        selected ? "bg-accent-600/10" : "bg-surface-900 hover:bg-surface-850",
      )}
    >
      {selectMode && (
        <SelectBox
          checked={selected}
          onToggle={() => onToggleSelect(entry.mediaId)}
        />
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
        onChange={(e) => onQuickSave(entry, { score: Number(e.target.value) })}
        className="h-8 rounded-lg border border-surface-700 bg-surface-900 px-1.5 text-sm text-gold focus:border-accent-500 focus:outline-none"
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
          onChange={(e) =>
            onQuickSave(entry, { progress: Number(e.target.value) })
          }
          onPointerEnter={openProgress}
          onFocus={openProgress}
          onMouseDown={openProgress}
          className="h-8 w-24 rounded-lg border border-surface-700 bg-surface-900 px-1.5 text-sm tabular-nums text-ink-300 focus:border-accent-500 focus:outline-none"
          aria-label={t("common.progress")}
          title={t("common.progress")}
        >
          {progressOpened ? (
            Array.from({ length: max + 1 }, (_, n) => (
              <option key={n} value={n}>
                {n} / {max}
              </option>
            ))
          ) : (
            <option value={entry.progress}>
              {entry.progress} / {max}
            </option>
          )}
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
            onClick={() => play(media.id)}
            aria-label={t("common.playNext")}
            title={t("common.playNext")}
          >
            <Play className="size-3.75" />
          </Button>
        )}
        <Button
          variant="secondary"
          size="icon"
          onClick={() => onQuickSave(entry, { progress: entry.progress + 1 })}
          disabled={!canIncrement(entry)}
          aria-label={t("common.plusOne")}
          title={t("common.plusOne")}
        >
          <Plus className="size-3.75" />
        </Button>
        {entry.status !== "COMPLETED" && (
          <Button
            variant="ghost"
            size="icon"
            className="text-emerald-400"
            onClick={() => onComplete(entry)}
            aria-label={t("common.complete")}
            title={t("common.complete")}
          >
            <CheckCheck className="size-3.75" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(entry)}
          aria-label={t("common.edit")}
          title={t("common.edit")}
        >
          <Pencil className="size-3.5" />
        </Button>
      </div>
        </>
      )}
    </div>
  );
});
