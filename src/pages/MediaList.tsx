import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  CheckSquare,
  CloudOff,
  Dices,
  LayoutGrid,
  List as ListIcon,
  RefreshCw,
  Search as SearchIcon,
} from "lucide-react";
import { useAuth } from "@/stores/auth";
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
import EntryEditModal from "@/components/media/EntryEditModal";
import { CoverGridSkeleton } from "@/components/Skeleton";
import ConfirmDialog from "@/components/overlays/ConfirmDialog";
import { isTyping } from "@/components/shell/KeyboardSheet";
import { nextFocus, type Move } from "@/lib/roving";
import RandomPickModal from "@/components/overlays/RandomPickModal";
import PresetModal from "@/components/overlays/PresetModal";
import { loadPresets, savePresets, type Preset } from "@/lib/presets";
import { collectTags, tagsOf } from "@/lib/tags";
import { searchHaystack } from "@/lib/search";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Segmented } from "@/components/ui/segmented";
import { FilterSelect } from "@/components/ui/filter-select";
import { StatusTabs } from "@/components/ui/status-tabs";
import { CoverOutline, EmptyState, StruckQuery } from "@/components/EmptyState";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Presence, PresenceIf } from "@/components/ui/presence";
import { VirtualGrid } from "@/components/list/VirtualGrid";
import { GridCard } from "@/components/list/GridCard";
import { ListRow, type RowPatch } from "@/components/list/ListRow";
import { ListHeader } from "@/components/list/ListHeader";
import { ROW_HEIGHT_PX } from "@/components/list/columns";
import { useRowTier } from "@/hooks/useRowTier";
import { BulkBar } from "@/components/list/BulkBar";
import { canIncrement } from "@/components/list/shared";

type SortKey = "updated" | "title" | "score" | "progress";

const SORT_KEYS: SortKey[] = ["updated", "title", "score", "progress"];

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
  const [focus, setFocus] = useState<number | null>(null);
  const [columns, setColumns] = useState(1);
  const [removing, setRemoving] = useState<MediaListEntry | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Which list columns fit. Measured off the scroll container rather than a
  // viewport breakpoint — a fixed grid track overflows instead of shrinking, so
  // the set has to change with the space a row really has.
  const tier = useRowTier(scrollRef, type === "MANGA");
  const navigate = useNavigate();

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
  const { save, bulkSave, remove } = useListMutations(userId, type);

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
      patch: RowPatch,
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

  // Above the early returns because the keydown effect below has no dependency
  // array and so re-subscribes on every commit — including the error commit,
  // which returns before this line. Declared down there, the live listener
  // closed over a `const` that had never been initialized, and pressing Escape
  // (or `s` then Escape) threw a TDZ error into the window handler, where it
  // did nothing visible. The error branch renders with a full `entries`,
  // because a failed refetch leaves the previous `data` in place.
  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const selectedEntries = useMemo(
    () => entries.filter((e) => selected.has(e.mediaId)),
    [entries, selected],
  );

  const { mutate: removeMutate } = remove;

  /**
   * The list's own key group.
   *
   * A roving index rather than real DOM focus: the rows are virtualized, so
   * the element holding focus is unmounted the moment it scrolls out of view
   * and the browser drops the focus to `body`. The index survives that, and
   * `VirtualGrid` scrolls it back into existence when it moves.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Anything modal owns the keyboard while it is up, and a field owns it
      // while the caret is in one.
      if (isTyping() || document.querySelector("[data-overlay]")) return;
      if (editing || removing || showRandom || showPresetSave) return;
      if (e.altKey) return;
      if (entries.length === 0) return;

      const entry = focus === null ? undefined : entries[focus];

      const move = (direction: Move) => {
        e.preventDefault();
        const next = nextFocus(focus, direction, columns, entries.length);
        if (next === null) return;
        setFocus(next);
        // Shift extends the selection one step at a time, which is what a
        // range select is when the anchor is wherever you started holding it.
        if (e.shiftKey) {
          setSelectMode(true);
          setSelected((prev) => new Set(prev).add(entries[next].mediaId));
        }
      };

      switch (e.key) {
        case "ArrowRight":
          return move("right");
        case "ArrowLeft":
          return move("left");
        case "ArrowDown":
          return move("down");
        case "ArrowUp":
          return move("up");
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === "a") {
          e.preventDefault();
          setSelectMode(true);
          setSelected(new Set(entries.map((x) => x.mediaId)));
        }
        return;
      }

      if (e.key === "Escape") {
        if (selectMode) exitSelect();
        else setFocus(null);
        return;
      }

      // Everything below acts on the focused entry, so there has to be one.
      if (focus === null || !entry) return;

      switch (e.key) {
        case "Enter":
          e.preventDefault();
          navigate(`/media/${entry.media.id}`);
          break;
        case " ":
          // Without this the page scrolls a screen down under the grid.
          e.preventDefault();
          if (selectMode) toggleSelect(entry.mediaId);
          else if (canIncrement(entry)) plusOne(entry);
          break;
        case "e":
          e.preventDefault();
          startEdit(entry);
          break;
        case "c":
          e.preventDefault();
          complete(entry);
          break;
        case "s":
          e.preventDefault();
          if (selectMode) exitSelect();
          else setSelectMode(true);
          break;
        case "Delete":
          e.preventDefault();
          setRemoving(entry);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Deliberately no dependency array. The handler closes over the focus, the
    // selection and the filtered pool, all of which change constantly; a
    // dependency list here would be every one of them, and getting it wrong
    // leaves the keys acting on a stale list. Re-binding one window listener
    // per render costs nothing next to the render itself.
  });

  // A filter or a tab change re-pools the entries, and index 12 in the old
  // pool is a different title in the new one.
  useEffect(() => setFocus(null), [tab, deferredFilter, tagFilter, sort]);

  const unit = type === "ANIME" ? t("common.episodes") : t("common.chapters");

  if (isLoading) {
    // The grid, not a sentence: the list is the whole screen, and a line of
    // text where a wall of covers is about to appear moves everything twice.
    return (
      <div className="px-8 py-6">
        <CoverGridSkeleton />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-8">
        <p className="text-danger">
          {t("list.loadError", { message: String(error) })}
        </p>
        <Button className="mt-4" variant="secondary" onClick={() => refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  // One mutation for the whole selection, not one per entry — see
  // `useListMutations.bulkSave`.
  const bulkStatus = (status: MediaListStatus) =>
    bulkSave.mutate({ entries: selectedEntries, patch: { status } });
  const bulkScore = (score: number) =>
    bulkSave.mutate({ entries: selectedEntries, patch: { score } });
  const bulkDelete = () => {
    selectedEntries.forEach((e) => remove.mutate(e.id));
    setSelected(new Set());
  };
  return (
    <div className="flex h-full flex-col">
      {(data?.fromCache || (data?.pending ?? 0) > 0) && (
        <div className="flex items-center gap-3 border-b border-surface-800 bg-gold/10 px-8 py-2 text-xs text-gold">
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
          // Two different nothings. A tab with no entries is a fact about the
          // list; a search that matched none is a fact about the query, and
          // the old single message could not tell them apart — so it never
          // offered the one thing that fixes the second case.
          filter || tagFilter ? (
            <EmptyState
              visual={<StruckQuery query={filter || tagFilter} />}
              title={t("list.noMatch", {
                status: t(`status.${type}.${tab}`),
              })}
              actions={
                <Button
                  variant="outline"
                  size="control"
                  onClick={() => {
                    setFilter("");
                    setTagFilter("");
                  }}
                >
                  {t("list.clearFilter")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              visual={<CoverOutline />}
              title={t("list.emptyTab", {
                status: t(`status.${type}.${tab}`),
              })}
              hint={t("list.emptyTabHint")}
            />
          )
        ) : grid ? (
          <VirtualGrid
            items={entries}
            scrollRef={scrollRef}
            gridClassName="media-grid gap-x-4"
            rowGap={24}
            estimateRowHeight={300}
            focusIndex={focus}
            onColumns={setColumns}
            renderItem={(entry, i) => (
              <GridCard
                key={entry.id}
                entry={entry}
                focused={i === focus}
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
            <ListHeader tier={tier} selectMode={selectMode} mediaType={type} />
            {/* One entry per row. `2xl:grid-cols-2` used to put two side by side
                past 96rem, which is not a list — and it also made
                `useColumnCount` report 2, so the down arrow moved by two. */}
            <VirtualGrid
              items={entries}
              scrollRef={scrollRef}
              gridClassName="grid"
              rowGap={0}
              estimateRowHeight={ROW_HEIGHT_PX}
              focusIndex={focus}
              onColumns={setColumns}
              renderItem={(entry, i) => (
                <ListRow
                  key={entry.id}
                  entry={entry}
                  tier={tier}
                  focused={i === focus}
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
          names={selectedEntries.map((e) => displayTitle(e.media.title))}
        />
      )}

      {/* `Presence` rather than `{editing && …}`: the dialog keeps rendering
          the entry it was opened with while it animates away, instead of
          disappearing between frames. */}
      <Presence value={editing}>
        {(entry, leaving) => (
          <EntryEditModal
            leaving={leaving}
            media={{ ...entry.media, type }}
            entry={entry}
            tagSuggestions={allTags}
            onClose={() => setEditing(null)}
            onSave={(input) => {
              save.mutate(input);
              setEditing(null);
            }}
            onDelete={() => {
              remove.mutate(entry.id);
              setEditing(null);
            }}
          />
        )}
      </Presence>

      <Presence value={removing}>
        {(entry, leaving) => (
          <ConfirmDialog
            leaving={leaving}
            title={t("confirm.removeOne")}
            names={[displayTitle(entry.media.title)]}
            note={t("confirm.removeNote")}
            confirmLabel={t("common.remove")}
            onConfirm={() => {
              removeMutate(entry.id);
              setRemoving(null);
            }}
            onCancel={() => setRemoving(null)}
          />
        )}
      </Presence>

      <PresenceIf when={showRandom}>
        {(leaving) => (
          <RandomPickModal
            leaving={leaving}
            pool={byStatus.get("PLANNING") ?? []}
            onClose={() => setShowRandom(false)}
          />
        )}
      </PresenceIf>

      <PresenceIf when={showPresetSave}>
        {(leaving) => (
          <PresetModal
            leaving={leaving}
            presets={presets}
            onSave={addPreset}
            onDelete={deletePreset}
            onClose={() => setShowPresetSave(false)}
          />
        )}
      </PresenceIf>
    </div>
  );
}
