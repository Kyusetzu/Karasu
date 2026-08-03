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
  Check,
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
import { IconButton } from "@/components/ui/icon-button";
import { Segmented } from "@/components/ui/segmented";
import { FilterSelect } from "@/components/ui/filter-select";
import { StatusTabs } from "@/components/ui/status-tabs";
import { TitleLockup } from "@/components/TitleLockup";
import { CoverCell, CoverMeta } from "@/components/CoverCell";
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

      <div className="border-b border-surface-800 px-8 pb-3.5 pt-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-2xl font-bold text-ink-100">
              {type === "ANIME" ? t("list.animeTitle") : t("list.mangaTitle")}
            </h1>
            <span className="font-brand-jp text-[.8125rem] tracking-[.04em] text-ink-600">
              {type === "ANIME" ? t("list.animeNative") : t("list.mangaNative")}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Labelled, not a bare icon: this one changes the whole
                interaction model, so it is worth the width. */}
            <Button
              variant={selectMode ? "secondary" : "outline"}
              size="control"
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            >
              <CheckSquare className="size-3.75" />
              {t("bulk.select")}
            </Button>
            <IconButton
              variant="ghost"
              onClick={() => refetch()}
              disabled={isRefetching}
              aria-label={t("common.reload")}
            >
              <RefreshCw
                className={cn("size-4", isRefetching && "animate-spin")}
              />
            </IconButton>
          </div>
        </div>

        <StatusTabs
          className="mt-4"
          value={tab}
          onChange={setTab}
          tabs={STATUS_ORDER.map((status) => ({
            value: status,
            label: t(`status.${type}.${status}`),
            count: byStatus.get(status)?.length ?? 0,
          }))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 px-8 py-3.5">
          <div className="relative max-w-68 flex-[1_1_11rem]">
            <SearchIcon
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-600"
            />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("list.filterPlaceholder")}
              className="h-8.5 pl-8"
            />
          </div>
          <FilterSelect
            label={t("list.sortLabel")}
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            options={SORT_KEYS.map((k) => ({ value: k, label: t(`sort.${k}`) }))}
          />
          {allTags.length > 0 && (
            <FilterSelect
              label={t("list.tagLabel")}
              value={tagFilter}
              onChange={setTagFilter}
              placeholder={t("tags.allTags")}
              options={allTags.map((tag) => ({ value: tag, label: tag }))}
            />
          )}
          {presets.length > 0 && (
            <FilterSelect
              label={t("list.presetLabel")}
              value=""
              onChange={(v) => v && applyPreset(v)}
              placeholder={t("presets.apply")}
              options={presets.map((p) => ({ value: p.name, label: p.name }))}
            />
          )}
          <IconButton
            variant="surface"
            onClick={() => setShowPresetSave(true)}
            aria-label={t("presets.save")}
            title={t("presets.save")}
          >
            <Bookmark className="size-4" />
          </IconButton>
          <IconButton
            variant="surface"
            onClick={() => setShowRandom(true)}
            aria-label={t("random.pick")}
            title={t("random.pick")}
          >
            <Dices className="size-4" />
          </IconButton>
          <Segmented
            className="ml-auto"
            aria-label={t("list.view")}
            value={grid ? "grid" : "rows"}
            onChange={(v) => setGrid(v === "grid")}
            segments={[
              {
                value: "grid",
                title: t("list.gridView"),
                label: <LayoutGrid className="size-3.75" />,
              },
              {
                value: "rows",
                title: t("list.listView"),
                label: <ListIcon className="size-3.75" />,
              },
            ]}
          />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-8 pb-12 pt-1">
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
          <div className="overflow-hidden rounded-xl border border-surface-800">
            <VirtualGrid
              items={entries}
              scrollRef={scrollRef}
              gridClassName="grid 2xl:grid-cols-2"
              rowGap={0}
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
    // Same inset-well substance as the now-playing card, for the same reason:
    // it appears unprompted over content that is already there, and reading as
    // a different material is how it announces itself without a colour shout.
    <div className="inset-well well-edge relative mx-8 mb-5 flex flex-wrap items-center gap-2.5 overflow-hidden rounded-[.875rem] px-4.5 py-3">
      <span className="text-[.8125rem] font-semibold tabular-nums text-ink-100">
        {t("bulk.selected", { count })}
      </span>
      <span className="h-4 w-px bg-surface-700" />

      <FilterSelect
        label={t("bulk.setStatus")}
        value=""
        placeholder="—"
        onChange={(v) => v && onStatus(v as MediaListStatus)}
        options={STATUS_ORDER.map((s) => ({
          value: s,
          label: t(`status.${type}.${s}`),
        }))}
        className={cn(disabled && "pointer-events-none opacity-50")}
      />

      <FilterSelect
        label={t("bulk.setScore")}
        value=""
        placeholder="—"
        onChange={(v) => v !== "" && onScore(Number(v))}
        options={[
          { value: "0", label: "–" },
          ...Array.from({ length: 10 }, (_, i) => ({
            value: String(i + 1),
            label: `★ ${i + 1}`,
          })),
        ]}
        className={cn(disabled && "pointer-events-none opacity-50")}
      />

      {confirmDelete ? (
        <Button variant="danger" size="control" disabled={disabled} onClick={onDelete}>
          {t("bulk.confirmDelete", { count })}
        </Button>
      ) : (
        <Button
          variant="dangerGhost"
          size="control"
          disabled={disabled}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="size-3.5" /> {t("common.remove")}
        </Button>
      )}

      <Button
        variant="ghost"
        size="control"
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
        "grid size-5 shrink-0 place-items-center rounded-[.3125rem] border transition-surface",
        // Near-opaque unchecked, because it sits on arbitrary cover art and a
        // translucent box has no contrast floor there.
        checked
          ? "border-accent-500 bg-accent-500 text-accent-ink"
          : "border-[rgba(255,255,255,.35)] bg-[rgba(4,5,8,.7)] text-transparent hover:border-accent-500",
        className,
      )}
      role="checkbox"
      aria-checked={checked}
      aria-label={t("bulk.select")}
    >
      <Check className="size-3.25" strokeWidth={3} />
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
  return (
    <CoverCell
      to={`/media/${media.id}`}
      cover={media.coverImage.large}
      data-media-id={media.id}
      data-media-type={media.type}
      selected={selectMode && selected}
      // In select mode the cover *is* the checkbox target — navigating away
      // mid-selection is never what the click meant.
      onCoverClick={
        selectMode ? () => onToggleSelect(entry.mediaId) : undefined
      }
      coverLabel={t("bulk.select")}
      score={!selectMode && entry.score > 0 ? entry.score : undefined}
      progress={max ? { current: entry.progress, total: max } : null}
      overlay={
        selectMode ? (
          <SelectBox
            checked={selected}
            onToggle={() => onToggleSelect(entry.mediaId)}
            className="absolute left-2 top-2 z-20"
          />
        ) : (
          // Deepens the foot of the cover only while the actions are showing,
          // so the three circles have a ground without dimming every poster
          // in the grid permanently.
          <div className="cover-scrim pointer-events-none absolute inset-x-0 bottom-0 h-[45%] opacity-0 transition-opacity group-hover:opacity-100" />
        )
      }
      actions={
        // Suppressed entirely in select mode: one interaction model at a time.
        !selectMode && (
          <div className="flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <IconButton
              variant="onCover"
              size="sm"
              round
              onClick={() => onEdit(entry)}
              aria-label={t("common.edit")}
              title={t("common.edit")}
            >
              <Pencil className="size-3.5" />
            </IconButton>
            {entry.status !== "COMPLETED" && (
              <IconButton
                variant="onCover"
                size="sm"
                round
                onClick={() => onComplete(entry)}
                aria-label={t("common.complete")}
                title={t("common.complete")}
                className="text-success"
              >
                <CheckCheck className="size-3.5" />
              </IconButton>
            )}
            {canIncrement(entry) && (
              <IconButton
                variant="accent"
                size="sm"
                round
                onClick={() => onPlusOne(entry)}
                aria-label={t("common.plusOne")}
                title={t("common.plusOne")}
              >
                <Plus className="size-4" />
              </IconButton>
            )}
          </div>
        )
      }
    >
      <Link to={`/media/${media.id}`}>
        <TitleLockup
          title={media.title}
          clamp={2}
          tone="muted"
          className="mt-2"
        />
      </Link>
      <CoverMeta>
        {entry.progress}
        {max ? ` / ${max}` : ""} {unit}
      </CoverMeta>
      <TagChips notes={entry.notes} />
    </CoverCell>
  );
});

/** Read-only tag chips derived from an entry's notes (capped for layout). */
function TagChips({
  notes,
  max = 3,
  className,
}: {
  notes: string | null;
  max?: number;
  className?: string;
}) {
  const tags = tagsOf(notes);
  // Still occupies its column when empty — a row whose neighbours shift left
  // because it happens to have no tags is harder to scan than a gap.
  if (tags.length === 0) return className ? <div className={className} /> : null;
  return (
    <div className={cn("mt-1 flex flex-wrap gap-1", className)}>
      {tags.slice(0, max).map((tag) => (
        <span
          key={tag}
          className="rounded-[.625rem] border border-surface-800 bg-surface-850 px-1.25 py-px text-2xs text-accent-400"
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
        "flex items-center gap-3.5 border-b border-surface-950 px-3.5 py-2 transition-surface",
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
          className="h-13.5 w-9.5 rounded-[.3125rem] object-cover"
        />
      </Link>
      <Link to={`/media/${media.id}`} className="min-w-0 flex-1">
        <TitleLockup title={media.title} />
      </Link>

      {selectMode ? null : (
        <>
      {/* Fixed-width from here on, so the columns line up down the list even
          though every title above them is a different length. */}
      <TagChips notes={entry.notes} max={4} className="w-32 justify-end" />

      {/* Quick score */}
      <select
        value={entry.score}
        onChange={(e) => onQuickSave(entry, { score: Number(e.target.value) })}
        className="h-8 w-13 rounded-md border border-surface-800 bg-surface-900 px-1.5 text-xs text-gold transition-surface focus:border-accent-500 focus:outline-none"
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
          className="h-8 w-18 rounded-md border border-surface-800 bg-surface-900 px-1.5 text-xs tabular-nums text-ink-300 transition-surface focus:border-accent-500 focus:outline-none"
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
        <span className="w-18 pr-1.5 text-right text-xs tabular-nums text-ink-300">
          {entry.progress}
          {max ? ` / ${max}` : ""}
        </span>
      )}

      <div className="flex gap-1">
        {canPlayNext && (
          <IconButton
            variant="ghost"
            size="xs"
            className="text-accent-400"
            onClick={() => play(media.id)}
            aria-label={t("common.playNext")}
            title={t("common.playNext")}
          >
            <Play className="size-3.5" />
          </IconButton>
        )}
        <IconButton
          variant="surface"
          size="xs"
          onClick={() => onQuickSave(entry, { progress: entry.progress + 1 })}
          disabled={!canIncrement(entry)}
          aria-label={t("common.plusOne")}
          title={t("common.plusOne")}
        >
          <Plus className="size-3.5" />
        </IconButton>
        {entry.status !== "COMPLETED" && (
          <IconButton
            variant="success"
            size="xs"
            onClick={() => onComplete(entry)}
            aria-label={t("common.complete")}
            title={t("common.complete")}
          >
            <CheckCheck className="size-3.5" />
          </IconButton>
        )}
        <IconButton
          variant="ghost"
          size="xs"
          onClick={() => onEdit(entry)}
          aria-label={t("common.edit")}
          title={t("common.edit")}
        >
          <Pencil className="size-3.5" />
        </IconButton>
      </div>
        </>
      )}
    </div>
  );
});
