import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  CheckSquare,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CloudOff,
  Dices,
  LayoutGrid,
  LayoutList,
  List as ListIcon,
  RefreshCw,
  Search as SearchIcon,
} from "lucide-react";
import { useAuth } from "@/stores/auth";
import { useContentFilter } from "@/stores/contentFilter";
import { blockReason, shouldBlur } from "@/lib/contentFilter";
import { FilteredNotice } from "@/components/FilteredNotice";
import { fetchMediaList, flushQueue } from "@/api/anilist";
import {
  displayTitle,
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
import { nextFocus, ownsKeyboard, type Move } from "@/lib/roving";
import RandomPickModal from "@/components/overlays/RandomPickModal";
import PresetModal from "@/components/overlays/PresetModal";
import { loadPresets, savePresets, type Preset } from "@/lib/presets";
import { formatLabel, MEDIA_FORMATS, ORIGINS, originLabel } from "@/lib/format";
import { customListNames } from "@/lib/customLists";
import { collectTags, tagsOf } from "@/lib/tags";
import { searchTitles } from "@/lib/search";
import { fuzzyScore, prepareDoc, prepareQuery, type FuzzyDoc } from "@/lib/fuzzy";
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
import type { BulkPatch } from "@/api/anilist";
import { ListHeader } from "@/components/list/ListHeader";
import { ROW_HEIGHT_PX, TEXT_ROW_HEIGHT_PX } from "@/components/list/columns";
import { PHONE_ROW_PX, PhoneRow } from "@/components/list/PhoneRow";
import { useRowTier } from "@/hooks/useRowTier";
import { loadViewMode, saveViewMode, type ViewMode } from "@/lib/viewMode";
import { usePhoneShell } from "@/hooks/usePhoneShell";
import { BulkBar } from "@/components/list/BulkBar";
import { canIncrement } from "@/components/list/shared";
import { COMPLETION_CONFIRM_REQUESTS, splitBulkPatch } from "@/lib/completion";
import { adjacentTab } from "@/lib/navSwipe";
import { useTabSwipe } from "@/hooks/useTabSwipe";

type SortKey = "updated" | "title" | "score" | "progress";
type SortDir = "asc" | "desc";

const SORT_KEYS: SortKey[] = ["updated", "title", "score", "progress"];

/** What each key means with no direction chosen, so a bare URL keeps its meaning; the toggle flips from this. */
const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  updated: "desc",
  title: "asc",
  score: "desc",
  progress: "desc",
};

// One collator, since localeCompare builds a fresh one per call; default options keep the ordering it gave.
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
          <Link to="/settings?pane=account">
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
  // The view lives in the URL, so back from a detail page restores it and a sidebar click starts clean.
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab");
  const tab: MediaListStatus = STATUS_ORDER.includes(rawTab as MediaListStatus)
    ? (rawTab as MediaListStatus)
    : "CURRENT";
  const rawSort = params.get("sort");
  const sort: SortKey = SORT_KEYS.includes(rawSort as SortKey)
    ? (rawSort as SortKey)
    : "updated";
  const rawDir = params.get("dir");
  const dir: SortDir =
    rawDir === "asc" || rawDir === "desc" ? rawDir : SORT_DEFAULT_DIR[sort];
  const tagFilter = params.get("tag") ?? "";
  const formats = MEDIA_FORMATS[type];
  const rawFormat = params.get("format") ?? "";
  const formatFilter = (formats as readonly string[]).includes(rawFormat) ? rawFormat : "";
  const rawCountry = params.get("country") ?? "";
  // Origin is a manga question, so the param is simply ignored on an anime list.
  const countryFilter =
    type === "MANGA" && (ORIGINS as readonly string[]).includes(rawCountry) ? rawCountry : "";
  const listFilter = params.get("list") ?? "";
  // The text filter alone keeps local state and mirrors into ?q= on a debounce, not a replaceState per keystroke.
  const [filter, setFilter] = useState(() => params.get("q") ?? "");
  // Remembered per media type, since the screen remounts on every navigation; all three exist on the phone too.
  const [layout, setLayout] = useState<ViewMode>(() => loadViewMode(type));
  /** The table's fixed tracks overflow a phone, so the two row views draw `PhoneRow` there instead. */
  const phone = usePhoneShell();
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
  const rootRef = useRef<HTMLDivElement>(null);
  // Which list columns fit, measured off the scroll container: a fixed grid track overflows instead of shrinking.
  const tier = useRowTier(scrollRef, type === "MANGA", layout !== "text");
  const navigate = useNavigate();
  const profileMode = useAuth((s) => s.mode);
  // The request count of a bulk completion waiting on a yes; null while nothing is asking.
  const [confirmComplete, setConfirmComplete] = useState<number | null>(null);

  // Clear the selection whenever the pool it refers to changes.
  useEffect(() => setSelected(new Set()), [tab]);

  // A tab is another list, so it opens at its top rather than wherever the last one was left.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [tab]);

  const toggleSelect = useCallback((mediaId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });
  }, []);

  /** The one writer for the URL view; separate setParams calls read stale snapshots and clobber each other. */
  const setView = useCallback(
    (
      patch: Partial<{
        tab: MediaListStatus;
        filter: string;
        tagFilter: string;
        sort: SortKey;
        /** Explicit direction, or "" for the sort key's own default. */
        dir: string;
        format: string;
        country: string;
        list: string;
      }>,
    ) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          const write = (key: string, value: string, def: string) =>
            value === def ? p.delete(key) : p.set(key, value);
          if (patch.tab !== undefined) write("tab", patch.tab, "CURRENT");
          if (patch.sort !== undefined) write("sort", patch.sort, "updated");
          if (patch.dir !== undefined) write("dir", patch.dir, "");
          if (patch.tagFilter !== undefined) write("tag", patch.tagFilter, "");
          if (patch.format !== undefined) write("format", patch.format, "");
          if (patch.country !== undefined) write("country", patch.country, "");
          if (patch.list !== undefined) write("list", patch.list, "");
          if (patch.filter !== undefined) write("q", patch.filter.trim(), "");
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Mirror the text filter into ?q= on the same debounce the other searches use, one write when typing settles.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (filter.trim() !== (params.get("q") ?? "")) setView({ filter });
    }, 500);
    return () => clearTimeout(timer);
    // `params` is deliberately not a dependency: it changes on the write this effect just made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, setView]);

  const applyPreset = (name: string) => {
    const p = presets.find((x) => x.name === name);
    if (!p) return;
    setFilter(p.filter);
    // `?? ""` on the newer fields: presets saved before they existed must clear the filters they never captured.
    setView({
      tab: p.tab as MediaListStatus,
      filter: p.filter,
      sort: p.sort as SortKey,
      dir: p.dir ?? "",
      tagFilter: p.tagFilter ?? "",
      format: p.format ?? "",
      country: p.country ?? "",
      list: p.list ?? "",
    });
  };

  const addPreset = (name: string) => {
    const next = [
      ...presets.filter((p) => p.name !== name),
      {
        name,
        tab,
        filter,
        sort,
        // The raw param, so a preset saved on the default direction keeps following the key's default.
        dir: rawDir ?? "",
        tagFilter,
        format: formatFilter,
        country: countryFilter,
        list: listFilter,
      },
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
  const { save, bulkSave, remove, bulkRemove } = useListMutations(userId, type);

  // The phone's sideways swipe walks the tabs in their row order and stops at both ends, never wrapping round.
  const canStepTab = useCallback((step: 1 | -1) => adjacentTab(STATUS_ORDER, tab, step) !== null, [tab]);
  const stepTab = useCallback(
    (step: 1 | -1) => {
      const next = adjacentTab(STATUS_ORDER, tab, step);
      if (next) setView({ tab: next });
    },
    [tab, setView],
  );
  useTabSwipe({
    surface: rootRef,
    content: scrollRef,
    // Off while selecting, since a tab change clears the selection, and until the list has mounted to swipe.
    enabled: phone && !selectMode && !isLoading && !error,
    canStep: canStepTab,
    onStep: stepTab,
  });

  const level = useContentFilter((s) => s.level);
  // Read here, not in the memoized rows: a store subscription there would re-render every card on any store move.
  const blurAdult = useContentFilter((s) => s.blurAdult);

  // Filtered here, not in the cache the scrobbler and matcher read, so every byStatus consumer shares one check.
  const { byStatus, hiddenAdult, hiddenSuggestive } = useMemo(() => {
    const map = new Map<MediaListStatus, MediaListEntry[]>();
    let adult = 0;
    let suggestive = 0;
    for (const status of STATUS_ORDER) map.set(status, []);
    for (const group of data?.lists ?? []) {
      if (group.isCustomList) continue;
      for (const entry of group.entries) {
        // Counted by reason in the pass that drops them, so the disclosure line and the list can never disagree.
        const reason = blockReason(entry.media, level);
        if (reason) {
          if (reason === "adult") adult++;
          else suggestive++;
          continue;
        }
        map.get(entry.status)?.push(entry);
      }
    }
    return { byStatus: map, hiddenAdult: adult, hiddenSuggestive: suggestive };
  }, [data, level]);

  // Union of tags across the whole list, for the filter + editor autocomplete.
  const allTags = useMemo(
    () =>
      collectTags(
        [...byStatus.values()].flat().map((e) => e.notes),
      ),
    [byStatus],
  );

  // Custom list names from the entries' membership maps, never the groups' display name; lib/customLists says why.
  const listNames = useMemo(() => customListNames(data?.lists ?? []), [data]);

  // A tag that no longer exists anywhere must not keep the list empty.
  useEffect(() => {
    if (tagFilter && !allTags.some((x) => x.toLowerCase() === tagFilter.toLowerCase()))
      setView({ tagFilter: "" });
  }, [allTags, tagFilter, setView]);

  // Same for a custom list deleted on anilist.co since the URL was minted.
  useEffect(() => {
    if (data && listFilter && !listNames.includes(listFilter)) setView({ list: "" });
  }, [data, listNames, listFilter, setView]);

  /** Search and sort keys, derived once per list change instead of once per entry per keystroke. */
  const searchKeys = useMemo(() => {
    const map = new Map<
      number,
      { doc: FuzzyDoc; tags: string[]; title: string }
    >();
    for (const list of byStatus.values()) {
      for (const e of list) {
        map.set(e.id, {
          doc: prepareDoc(searchTitles(e.media)),
          tags: tagsOf(e.notes).map((x) => x.toLowerCase()),
          title: displayTitle(e.media.title),
        });
      }
    }
    return map;
  }, [byStatus]);

  // Keeps the text field responsive: the filtered list renders at a lower priority than the keystroke echo.
  const deferredFilter = useDeferredValue(filter);

  const entries = useMemo(() => {
    let list = byStatus.get(tab) ?? [];
    const q = deferredFilter.trim();
    // While a query is set, relevance owns the order; the chosen sort survives as the tiebreak.
    let scores: Map<number, number> | null = null;
    if (q) {
      const pq = prepareQuery(q);
      const found = new Map<number, number>();
      list = list.filter((e) => {
        const doc = searchKeys.get(e.id)?.doc;
        const s = doc ? fuzzyScore(doc, pq) : 0;
        if (s > 0) found.set(e.id, s);
        return s > 0;
      });
      scores = found;
    }
    if (tagFilter) {
      const tag = tagFilter.toLowerCase();
      list = list.filter((e) => searchKeys.get(e.id)?.tags.includes(tag));
    }
    if (formatFilter) {
      list = list.filter((e) => e.media.format === formatFilter);
    }
    if (countryFilter) {
      // Blobs cached before the field existed read undefined and must not pass a country the entry never claimed.
      list = list.filter((e) => e.media.countryOfOrigin === countryFilter);
    }
    if (listFilter) {
      list = list.filter((e) => e.customLists?.[listFilter] === true);
    }
    // Each comparator returns its key's default order; a flipped direction negates it wholesale.
    const flip = dir === SORT_DEFAULT_DIR[sort] ? 1 : -1;
    return [...list].sort((a, b) => {
      if (scores) {
        const d = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
        if (d !== 0) return d;
      }
      const cmp = (() => {
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
      })();
      return cmp * flip;
    });
  }, [byStatus, tab, deferredFilter, tagFilter, formatFilter, countryFilter, listFilter, sort, dir, searchKeys]);

  // Hooks stay above the early returns; mutate is the stable reference, the mutation object it hangs off is not.
  const { mutate: saveMutate } = save;

  const quickSave = useCallback(
    (
      entry: MediaListEntry,
      patch: RowPatch,
    ) => saveMutate({ mediaId: entry.mediaId, ...patch }),
    [saveMutate],
  );

  const complete = useCallback(
    (entry: MediaListEntry) => quickSave(entry, { status: "COMPLETED" }),
    [quickSave],
  );

  const plusOne = useCallback(
    (entry: MediaListEntry) =>
      quickSave(entry, { progress: entry.progress + 1 }),
    [quickSave],
  );

  const startEdit = useCallback((entry: MediaListEntry) => setEditing(entry), []);

  // Above the early returns, or the keydown handler bound on the error commit closes over an uninitialized const.
  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  const selectedEntries = useMemo(
    () => entries.filter((e) => selected.has(e.mediaId)),
    [entries, selected],
  );

  const { mutate: removeMutate } = remove;

  /** The list's key group: a roving index rather than DOM focus, since a virtualized row unmounts when it scrolls away. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Anything modal owns the keyboard while it is up, and a field owns it while the caret is in one.
      if (isTyping() || document.querySelector("[data-overlay]")) return;
      // Any other focused control owns it too; keep this above the arrow branch, a focused select reads arrows as well.
      if (!ownsKeyboard(document.activeElement, document.body, scrollRef.current))
        return;
      if (editing || removing || showRandom || showPresetSave) return;
      if (e.altKey) return;
      if (entries.length === 0) return;

      const entry = focus === null ? undefined : entries[focus];

      const move = (direction: Move) => {
        e.preventDefault();
        const next = nextFocus(focus, direction, columns, entries.length);
        if (next === null) return;
        setFocus(next);
        // Shift extends the selection one step at a time, which is what a range select is from a held anchor.
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
    // Deliberately no dependency array: a missed entry would leave the keys acting on a stale list, and a rebind is cheap.
  });

  // A filter or tab change re-pools the entries, so an old index would name a different title.
  useEffect(
    () => setFocus(null),
    [tab, deferredFilter, tagFilter, formatFilter, countryFilter, listFilter, sort],
  );

  const unit = type === "ANIME" ? t("common.episodes") : t("common.chapters");

  if (isLoading) {
    // The grid, not a sentence: a line of text where a wall of covers is about to appear moves everything twice.
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

  // One mutation for the whole selection, not one per entry (useListMutations.bulkSave).
  const bulkPatch = (patch: BulkPatch) =>
    bulkSave.mutate({ entries: selectedEntries, patch });
  const bulkStatus = (status: MediaListStatus) => {
    // Local mode writes SQLite, so only an AniList completion has a request count worth asking about.
    const requests =
      status === "COMPLETED" && profileMode === "anilist"
        ? splitBulkPatch(selectedEntries, { status }, type).length
        : 1;
    if (requests > COMPLETION_CONFIRM_REQUESTS) setConfirmComplete(requests);
    else bulkPatch({ status });
  };
  const bulkScore = (score: number) => bulkPatch({ score });
  const bulkProgress = (progress: number) => bulkPatch({ progress });
  const bulkRepeat = (repeat: number) => bulkPatch({ repeat });
  const bulkPrivate = (hidden: boolean) => bulkPatch({ private: hidden });
  // One sequential mutation, not a concurrent request per entry, and there is no batch delete to use instead.
  const bulkDelete = () => {
    bulkRemove.mutate(selectedEntries);
    setSelected(new Set());
  };
  return (
    // Clipped sideways, so the list following a swipe never gives the page a horizontal scroll.
    <div ref={rootRef} className="flex h-full flex-col overflow-x-clip">
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
            {/* Labelled, not a bare icon: this one changes the whole interaction model, so it is worth the width. */}
            <Button
              variant={selectMode ? "secondary" : "outline"}
              size="control"
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            >
              <CheckSquare className="size-3.75" />
              {t("bulk.select")}
            </Button>
            {/* The phone shell syncs by pulling the list down, so the corner button would be a second spelling of it. */}
            {!phone && (
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
            )}
          </div>
        </div>

        <StatusTabs
          className="mt-4"
          value={tab}
          onChange={(v) => setView({ tab: v })}
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
              onClear={() => setFilter("")}
              clearLabel={t("common.clear")}
              className="h-8.5 pl-8"
            />
          </div>
          <FilterSelect
            label={t("list.sortLabel")}
            value={sort}
            // Changing the key clears the direction: "score, descending" was a choice about scores, not titles.
            onChange={(v) => setView({ sort: v as SortKey, dir: "" })}
            options={SORT_KEYS.map((k) => ({ value: k, label: t(`sort.${k}`) }))}
          />
          <IconButton
            variant="ghost"
            onClick={() => {
              const next: SortDir = dir === "asc" ? "desc" : "asc";
              setView({ dir: next === SORT_DEFAULT_DIR[sort] ? "" : next });
            }}
            aria-label={t(dir === "asc" ? "list.sortAsc" : "list.sortDesc")}
            title={t(dir === "asc" ? "list.sortAsc" : "list.sortDesc")}
          >
            {dir === "asc" ? (
              <ArrowUpNarrowWide className="size-4" />
            ) : (
              <ArrowDownWideNarrow className="size-4" />
            )}
          </IconButton>
          <FilterSelect
            label={t("list.formatLabel")}
            value={formatFilter}
            onChange={(v) => setView({ format: v })}
            placeholder={t("list.allFormats")}
            options={formats.map((f) => ({ value: f, label: formatLabel(f, t) }))}
          />
          {type === "MANGA" && (
            <FilterSelect
              label={t("list.originLabel")}
              value={countryFilter}
              onChange={(v) => setView({ country: v })}
              placeholder={t("list.allOrigins")}
              options={ORIGINS.map((c) => ({ value: c, label: originLabel(c, t) }))}
            />
          )}
          {listNames.length > 0 && (
            <FilterSelect
              label={t("list.listLabel")}
              value={listFilter}
              onChange={(v) => setView({ list: v })}
              placeholder={t("list.allLists")}
              options={listNames.map((n) => ({ value: n, label: n }))}
            />
          )}
          {allTags.length > 0 && (
            <FilterSelect
              label={t("list.tagLabel")}
              value={tagFilter}
              onChange={(v) => setView({ tagFilter: v })}
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
          {/* In the wrapping filter row on the phone as well, where the header row has no width to spare. */}
          <Segmented
            className="ml-auto"
            aria-label={t("list.view")}
            value={layout}
            onChange={(v) => {
              setLayout(v);
              saveViewMode(type, v);
            }}
            segments={[
              {
                value: "grid",
                title: t("list.viewGallery"),
                label: <LayoutGrid className="size-3.75" />,
              },
              {
                value: "rows",
                title: t("list.viewThumbs"),
                label: <LayoutList className="size-3.75" />,
              },
              {
                value: "text",
                title: t("list.viewList"),
                label: <ListIcon className="size-3.75" />,
              },
            ]}
          />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-8 pb-12 pt-1">
        {/* Above the grid, since VirtualGrid takes entries only; the whole-list count, so it does not jump per tab. */}
        <FilteredNotice adult={hiddenAdult} suggestive={hiddenSuggestive} className="mb-2" />
        {entries.length === 0 ? (
          // Two different nothings: an empty tab is a fact about the list, a search that matched none is about the query.
          filter || tagFilter || formatFilter || countryFilter || listFilter ? (
            <EmptyState
              visual={
                <StruckQuery
                  query={
                    filter ||
                    tagFilter ||
                    formatLabel(formatFilter, t) ||
                    countryFilter ||
                    listFilter
                  }
                />
              }
              title={t("list.noMatch", {
                status: t(`status.${type}.${tab}`),
              })}
              actions={
                <Button
                  variant="outline"
                  size="control"
                  onClick={() => {
                    setFilter("");
                    setView({ filter: "", tagFilter: "", format: "", country: "", list: "" });
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
        ) : layout === "grid" ? (
          <VirtualGrid
            // Keyed on the view and the shell, so no row height measured for one layout is reused by another.
            key={`grid-${phone}`}
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
                blurred={shouldBlur(entry.media, level, blurAdult)}
                onPlusOne={plusOne}
                onComplete={complete}
                onEdit={startEdit}
                selectMode={selectMode}
                selected={selected.has(entry.mediaId)}
                onToggleSelect={toggleSelect}
              />
            )}
          />
        ) : phone ? (
          <div className="overflow-hidden rounded-xl border border-surface-800">
            <VirtualGrid
              key={`phone-${layout}`}
              items={entries}
              scrollRef={scrollRef}
              // One bounded track: an `auto` one grows to a nowrap title and pushes the buttons out of the row.
              gridClassName="grid grid-cols-1"
              rowGap={0}
              estimateRowHeight={layout === "text" ? PHONE_ROW_PX.text : PHONE_ROW_PX.thumbs}
              focusIndex={focus}
              onColumns={setColumns}
              renderItem={(entry, i) => (
                <PhoneRow
                  key={entry.id}
                  entry={entry}
                  variant={layout === "text" ? "text" : "thumbs"}
                  unit={unit}
                  focused={i === focus}
                  blurred={shouldBlur(entry.media, level, blurAdult)}
                  onPlusOne={plusOne}
                  onEdit={startEdit}
                  selectMode={selectMode}
                  selected={selected.has(entry.mediaId)}
                  onToggleSelect={toggleSelect}
                />
              )}
            />
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-surface-800">
            <ListHeader tier={tier} selectMode={selectMode} mediaType={type} cover={layout !== "text"} />
            {/* Keep one entry per row: two side by side made useColumnCount report 2, so the down arrow moved by two. */}
            <VirtualGrid
              key={`table-${layout}`}
              items={entries}
              scrollRef={scrollRef}
              gridClassName="grid"
              rowGap={0}
              estimateRowHeight={layout === "text" ? TEXT_ROW_HEIGHT_PX : ROW_HEIGHT_PX}
              focusIndex={focus}
              onColumns={setColumns}
              renderItem={(entry, i) => (
                <ListRow
                  key={entry.id}
                  entry={entry}
                  tier={tier}
                  variant={layout === "text" ? "text" : "thumbs"}
                  focused={i === focus}
                  blurred={shouldBlur(entry.media, level, blurAdult)}
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
          onProgress={bulkProgress}
          onRepeat={bulkRepeat}
          onPrivate={bulkPrivate}
          onDelete={bulkDelete}
          onClear={exitSelect}
          names={selectedEntries.map((e) => displayTitle(e.media.title))}
        />
      )}

      {/* Presence rather than a bare conditional: the dialog keeps its entry while it animates away. */}
      <Presence value={editing}>
        {(entry, leaving) => (
          <EntryEditModal
            leaving={leaving}
            media={{ ...entry.media, type }}
            entry={entry}
            tagSuggestions={allTags}
            customListNames={listNames}
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

      <Presence value={confirmComplete}>
        {(requests, leaving) => (
          <ConfirmDialog
            leaving={leaving}
            title={t("bulk.completeTitle", { count: selectedEntries.length })}
            names={selectedEntries.slice(0, 3).map((e) => displayTitle(e.media.title))}
            extra={Math.max(0, selectedEntries.length - 3)}
            note={t("bulk.completeRequests", { n: requests })}
            confirmLabel={t("bulk.completeConfirm")}
            onConfirm={() => {
              bulkPatch({ status: "COMPLETED" });
              setConfirmComplete(null);
            }}
            onCancel={() => setConfirmComplete(null)}
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
