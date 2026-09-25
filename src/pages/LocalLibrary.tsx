import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { VirtualRows } from "@/components/list/VirtualRows";
import { Link } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, FolderOpen, HelpCircle, Play, Wand2 } from "lucide-react";
import { fetchMediaList, isTauri, saveListEntry } from "@/api/anilist";
import { mediaByIds } from "@/api/queries";
import { displayTitle, type Media, type MediaListEntry } from "@/api/types";
import { missingIds } from "@/lib/chunk";
import { fuzzyScore, prepareDoc, prepareQuery } from "@/lib/fuzzy";
import { loadDefaultAddStatus } from "@/lib/defaultAddStatus";
import { withCompletion } from "@/lib/completion";
import {
  clearLibraryMatch,
  getLibraryStatus,
  getLibraryUnmatched,
  pickLibraryFolder,
  scanLibrary,
  setLibraryMatch,
  setLibraryPath,
  setLibraryRedirect,
  type LibraryEntry,
  type LibraryFile,
  type TitleKey,
  type UnmatchedGroup,
} from "@/api/library";
import MatchPicker from "@/components/overlays/MatchPicker";
import { SeasonSplitModal, type SplitTarget } from "@/components/overlays/SeasonSplitModal";
import { useAuth } from "@/stores/auth";
import { useLibrary } from "@/stores/library";
import { showToast } from "@/stores/toast";
import { useContentFilter } from "@/stores/contentFilter";
import { blockReason, isBlocked, type BlockReason } from "@/lib/contentFilter";
import { FilteredNotice } from "@/components/FilteredNotice";
import { Button } from "@/components/ui/button";
import { Presence } from "@/components/ui/presence";
import { EmptyState, FolderStack } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { useTheme, type Density } from "@/stores/theme";
import { Spinner } from "@/components/ui/spinner";
import { SearchField } from "@/components/ui/search-field";

/** Above this the match was exact: a test for `best_match_prepared`'s equality branch, not a tolerance. */
const EXACT = 0.999;

// Hoisted because `localeCompare` builds a collator per call; default options keep its ordering.
const COLLATOR = new Intl.Collator();

/** The scanned local library; the index holds only media ids, so titles join from the cached list. */
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
          <Link to="/settings?pane=account">
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
  media: Media;
  /** The list entry, if any; a manual match can point files at a title the user never added. */
  entry: MediaListEntry | null;
  /** The first file past the user's progress, if there is one. */
  next: LibraryFile | null;
}

function LibraryView({ userId }: { userId: number }) {
  const { t } = useTranslation();
  const entries = useLibrary((s) => s.entries);
  const refresh = useLibrary((s) => s.refresh);
  const loadEntries = useLibrary((s) => s.loadEntries);
  const setError = useLibrary((s) => s.setError);
  const level = useContentFilter((s) => s.level);
  const [scanning, setScanning] = useState(false);

  // The full index is fetched here rather than at startup; only this screen reads its paths and scores.
  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const { data } = useQuery({
    queryKey: ["mediaList", "ANIME", userId],
    queryFn: () => fetchMediaList(userId, "ANIME"),
  });

  // What the path row says, kept in the query cache so a rescan can invalidate it in one place.
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ["libraryStatus"],
    queryFn: getLibraryStatus,
    enabled: isTauri,
  });

  // Filtered titles never enter this media_id → list entry map, so they cannot be listed here.
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

  // Every list id, blocked ones included; asking `byMedia` would refetch the titles the filter hides.
  const onList = useMemo(() => {
    const ids = new Set<number>();
    for (const group of data?.lists ?? []) {
      if (group.isCustomList) continue;
      for (const e of group.entries) ids.add(e.mediaId);
    }
    return ids;
  }, [data]);

  // Off-list library ids; keep them sorted and de-duplicated, or this query key defeats the cache.
  const offList = useMemo(
    () => missingIds(entries.map((e) => e.mediaId), onList),
    [entries, onList],
  );

  // Keep `placeholderData`: a correction mints a new key, and the section would blank while it refetches.
  const { data: fetched } = useQuery({
    queryKey: ["libraryMedia", offList],
    queryFn: () => mediaByIds(offList),
    enabled: offList.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30 * 60 * 1000,
  });

  const byId = useMemo(
    () => new Map((fetched ?? []).map((m) => [m.id, m])),
    [fetched],
  );

  // Why each blocked on-list id is hidden, read from the list data because `byMedia` lacks these rows.
  const blockedOnList = useMemo(() => {
    const map = new Map<number, BlockReason>();
    for (const group of data?.lists ?? []) {
      if (group.isCustomList) continue;
      for (const e of group.entries) {
        const reason = blockReason(e.media, level);
        if (reason) map.set(e.mediaId, reason);
      }
    }
    return map;
  }, [data, level]);

  // What the filter hid, by reason, counted from the rows' inputs so the line and list cannot disagree.
  const { hiddenAdult, hiddenSuggestive } = useMemo(() => {
    let adult = 0;
    let suggestive = 0;
    for (const lib of entries) {
      const reason =
        blockedOnList.get(lib.mediaId) ?? blockReason(byId.get(lib.mediaId), level);
      if (reason === "adult") adult++;
      else if (reason === "suggestive") suggestive++;
    }
    return { hiddenAdult: adult, hiddenSuggestive: suggestive };
  }, [entries, blockedOnList, byId, level]);

  const rows = useMemo<Row[]>(() => {
    const built = entries.flatMap((lib) => {
      const entry = byMedia.get(lib.mediaId) ?? null;
      // The title comes from the list or, when not on it, from AniList; an unknown id has nothing to draw.
      const media = entry?.media ?? byId.get(lib.mediaId);
      if (!media) return [];
      if (isBlocked(media, level)) return [];
      const progress = entry?.progress ?? 0;
      const next = lib.files.find((f) => f.episode > progress) ?? null;
      return [{ lib, media, entry, next }];
    });
    // Titles resolved once and sorted with the hoisted collator, not re-derived for every comparison.
    const titles = new Map(built.map((r) => [r.lib.mediaId, displayTitle(r.media.title)]));
    return built.sort((a, b) =>
      COLLATOR.compare(
        titles.get(a.lib.mediaId) ?? "",
        titles.get(b.lib.mediaId) ?? "",
      ),
    );
  }, [entries, byMedia, byId, level]);

  // Files the scanner could not place, cached beside the status so one rescan invalidates both.
  const { data: unmatched, refetch: refetchUnmatched } = useQuery({
    queryKey: ["libraryUnmatched"],
    queryFn: getLibraryUnmatched,
    enabled: isTauri,
  });

  // A suggested group has an answer to check and a bare one has none, so the two get separate sections.
  const suggested = useMemo(
    () => (unmatched ?? []).filter((g) => g.suggestion),
    [unmatched],
  );

  // Covers and titles for the suggested media, fetched the same way the off-list rows are.
  const suggestedIds = useMemo(
    () => missingIds(suggested.map((g) => g.suggestion!.mediaId), new Set()),
    [suggested],
  );
  const { data: suggestedMedia } = useQuery({
    queryKey: ["librarySuggestedMedia", suggestedIds],
    queryFn: () => mediaByIds(suggestedIds),
    enabled: suggestedIds.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30 * 60 * 1000,
  });
  const suggestedById = useMemo(
    () => new Map((suggestedMedia ?? []).map((m) => [m.id, m])),
    [suggestedMedia],
  );

  // The identify pass has no `isAdult` constraint, so suggestions are filtered here; unresolved media stays visible.
  const blocked = useCallback(
    (g: UnmatchedGroup) =>
      !!g.suggestion && isBlocked(suggestedById.get(g.suggestion.mediaId), level),
    [suggestedById, level],
  );
  const visibleSuggestions = useMemo(
    () => suggested.filter((g) => !blocked(g)),
    [suggested, blocked],
  );
  // A blocked guess is demoted to unplaced, which prints only the parsed name, not dropped with its picker route.
  const failed = useMemo(
    () => (unmatched ?? []).filter((g) => !g.suggestion || blocked(g)),
    [unmatched, blocked],
  );

  // One scroller for every section's VirtualRows; expand state lives here because virtual rows unmount.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const toggleRow = useCallback((mediaId: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (!next.delete(mediaId)) next.add(mediaId);
      return next;
    });
  }, []);

  // What the picker is open on, a row or an unplaced group; one state, so two cannot be open at once.
  const [editing, setEditing] = useState<{
    key: TitleKey;
    current?: string;
    hasOverride: boolean;
  } | null>(null);

  // The error shows in the picker, which covers the banner; a caller with no picker open passes the banner.
  const [correctError, setCorrectError] = useState<string | null>(null);
  const runCorrection = useCallback(
    async (
      work: () => Promise<unknown>,
      report: (msg: string) => void = setCorrectError,
    ) => {
      setCorrectError(null);
      try {
        await work();
        setEditing(null);
        await Promise.all([refresh(), refetchStatus(), refetchUnmatched()]);
      } catch (e) {
        report(typeof e === "string" ? e : t("library.correctFailed"));
      }
    },
    [refresh, refetchStatus, refetchUnmatched, t],
  );

  // The season-split target and its own error line, kept in the dialog because it covers the app banner.
  const [splitting, setSplitting] = useState<SplitTarget | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [splitPending, setSplitPending] = useState(false);
  const applySplit = useCallback(
    async (mediaId: number, dstStart: number, label: string) => {
      if (!splitting) return;
      setSplitError(null);
      setSplitPending(true);
      try {
        // Keyed on the row's displayed numbers; the backend resolves files, so a chained split cannot miss.
        await setLibraryRedirect(
          splitting.mediaId,
          splitting.overflow.firstExtra,
          splitting.maxEpisode,
          mediaId,
          dstStart,
        );
        setSplitting(null);
        // The row often barely changes, so the toast is what says the split landed.
        showToast({
          kind: "success",
          text: t("library.splitDone", {
            from: splitting.overflow.firstExtra,
            to: splitting.maxEpisode,
            title: label,
          }),
        });
        await Promise.all([refresh(), refetchStatus(), refetchUnmatched()]);
      } catch (e) {
        setSplitError(typeof e === "string" ? e : t("library.correctFailed"));
      } finally {
        setSplitPending(false);
      }
    },
    [splitting, refresh, refetchStatus, refetchUnmatched, t],
  );

  const applyMatch = useCallback(
    (mediaId: number) =>
      runCorrection(() =>
        editing
          ? setLibraryMatch(editing.key.title, editing.key.season, mediaId)
          : Promise.resolve(),
      ),
    [editing, runCorrection],
  );

  const dropMatch = useCallback(
    () =>
      runCorrection(() =>
        editing
          ? clearLibraryMatch(editing.key.title, editing.key.season)
          : Promise.resolve(),
      ),
    [editing, runCorrection],
  );

  // Accepting a suggestion is an ordinary correction: same command, same override row, answered by search.
  const confirmSuggestion = useCallback(
    (key: TitleKey, mediaId: number) =>
      runCorrection(
        () => setLibraryMatch(key.title, key.season, mediaId),
        setError,
      ),
    [runCorrection, setError],
  );

  // Adding makes the title scrobblable; the media goes along because `local_save_entry` needs its type.
  const qc = useQueryClient();
  const addToList = useCallback(
    async (media: Media) => {
      try {
        // A first add, so a default of Completed arrives with the totals rather than at zero.
        await saveListEntry(
          withCompletion({ mediaId: media.id, status: loadDefaultAddStatus() }, media, "ANIME", null),
          media,
        );
        // The invalidate moves the row; `useListMutations` patches existing entries and a first add has none.
        await qc.invalidateQueries({ queryKey: ["mediaList", "ANIME", userId] });
      } catch (e) {
        setError(typeof e === "string" ? e : t("library.addFailed"));
      }
    },
    [qc, userId, setError, t],
  );

  // On-list rows split into ready and done; titles resolved but never added are their own section below.
  const onListRows = rows.filter((r) => r.entry);
  const ready = onListRows.filter((r) => r.next);
  const done = onListRows.filter((r) => !r.next);
  const offListRows = rows.filter((r) => !r.entry);

  const rescan = async () => {
    setScanning(true);
    try {
      await scanLibrary();
      await refresh();
      await refetchStatus();
      await refetchUnmatched();
    } catch {
      /* the folder may be unset — Settings owns that flow */
    } finally {
      setScanning(false);
    }
  };

  const change = async () => {
    // This page has no error line of its own, so a rejection here goes to a toast rather than nowhere.
    try {
      const picked = await pickLibraryFolder();
      if (!picked) return;
      await setLibraryPath(picked);
    } catch (e) {
      showToast({ kind: "error", text: t("library.folderFailed"), detail: String(e) });
      return;
    }
    await rescan();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none px-8 pb-4 pt-7">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[1.375rem] font-bold tracking-[-.015em] text-ink-100">
            {t("library.title")}
          </h1>
          <span className="font-brand-jp text-ui tracking-lockup text-ink-600">
            ライブラリ
          </span>
          <Button
            variant="outline"
            size="control"
            className="ml-auto"
            onClick={rescan}
            disabled={scanning}
          >
            <Spinner spinning={scanning} className="size-3.5" />
            {scanning ? t("settings.libraryScanning") : t("settings.libraryScan")}
          </Button>
        </div>

        {/* The folder and what the last scan made of it, or the screen never says where the files came from. */}
        <div className="mt-3.5 flex max-w-176 items-center gap-2.5 rounded-control border border-hair bg-surface-900 px-3 py-2.25">
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

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
        <FilteredNotice adult={hiddenAdult} suggestive={hiddenSuggestive} className="mb-2" />
        {rows.length === 0 && !unmatched?.length ? (
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
            <Group
              label={t("library.readyToPlay")}
              rows={ready}
              scrollRef={scrollRef}
              expanded={expandedRows}
              onToggle={toggleRow}
              onCorrect={setEditing}
              onAdd={addToList}
              onSplit={setSplitting}
            />
            <Group
              label={t("library.upToDate")}
              rows={done}
              muted
              scrollRef={scrollRef}
              expanded={expandedRows}
              onToggle={toggleRow}
              onCorrect={setEditing}
              onAdd={addToList}
              onSplit={setSplitting}
            />
            <DetectedOffList
              rows={offListRows}
              suggestions={visibleSuggestions}
              media={suggestedById}
              scrollRef={scrollRef}
              expanded={expandedRows}
              onToggle={toggleRow}
              onCorrect={setEditing}
              onAdd={addToList}
              onConfirm={confirmSuggestion}
              onReject={(key) => setEditing({ key, hasOverride: false })}
              onSplit={setSplitting}
            />
            <Unplaced
              groups={failed}
              scrollRef={scrollRef}
              onAssign={(key) => setEditing({ key, hasOverride: false })}
            />
          </>
        )}
      </div>

      <Presence value={editing}>
        {(target, leaving) => (
          <MatchPicker
            leaving={leaving}
            parsedTitle={target.key.title}
            season={target.key.season}
            current={target.current}
            error={correctError ?? undefined}
            onPick={applyMatch}
            onClear={target.hasOverride ? dropMatch : undefined}
            onCancel={() => {
              setCorrectError(null);
              setEditing(null);
            }}
          />
        )}
      </Presence>

      <Presence value={splitting}>
        {(target, leaving) => (
          <SeasonSplitModal
            leaving={leaving}
            target={target}
            error={splitError}
            pending={splitPending}
            onConfirm={applySplit}
            onClose={() => {
              setSplitError(null);
              setSplitting(null);
            }}
          />
        )}
      </Presence>
    </div>
  );
}

/** Titles resolved to a show you have not added; unconfirmed suggestions stay greyed until confirmed. */
function DetectedOffList({
  rows,
  suggestions,
  media,
  scrollRef,
  expanded,
  onToggle,
  onCorrect,
  onAdd,
  onConfirm,
  onReject,
  onSplit,
}: {
  rows: Row[];
  suggestions: UnmatchedGroup[];
  media: Map<number, Media>;
  scrollRef: RefObject<HTMLDivElement | null>;
  expanded: ReadonlySet<number>;
  onToggle: (mediaId: number) => void;
  onCorrect: (c: Correction) => void;
  onAdd: (media: Media) => void;
  onConfirm: (key: TitleKey, mediaId: number) => void;
  onReject: (key: TitleKey) => void;
  onSplit: (t: SplitTarget) => void;
}) {
  const density = useTheme((s) => s.density);
  const { t } = useTranslation();
  // One virtualizer over a tagged union of both row shapes; two would each measure a start and overlap.
  const items = useMemo(
    () => [
      ...rows.map((row) => ({ kind: "row" as const, row })),
      ...suggestions.map((group) => ({ kind: "suggestion" as const, group })),
    ],
    [rows, suggestions],
  );
  if (rows.length === 0 && suggestions.length === 0) return null;

  return (
    <section className="pt-6">
      <p className="mb-1 text-xs font-medium uppercase tracking-[.12em] text-ink-600">
        {t("library.detectedOffList")}
      </p>
      <p className="mb-3 text-2xs text-ink-600">
        {t("library.detectedOffListHint")}
      </p>
      <VirtualRows
        items={items}
        scrollRef={scrollRef}
        estimateRowHeight={ROW_HEIGHT[density]}
        getKey={(item) =>
          item.kind === "row"
            ? `r:${item.row.lib.mediaId}`
            : `s:${item.group.title}:${item.group.season}`
        }
        className="overflow-hidden rounded-panel border border-hair"
        renderItem={(item, _i, isLast) =>
          item.kind === "row" ? (
            <LibraryRow
              row={item.row}
              muted={false}
              last={isLast}
              open={expanded.has(item.row.lib.mediaId)}
              onToggle={onToggle}
              onCorrect={onCorrect}
              onAdd={onAdd}
              onSplit={onSplit}
            />
          ) : (
            <SuggestionRow
              group={item.group}
              media={media.get(item.group.suggestion!.mediaId)}
              last={isLast}
              onConfirm={onConfirm}
              onReject={onReject}
            />
          )
        }
      />
    </section>
  );
}

/** One unconfirmed guess, shown greyed until it is accepted. */
function SuggestionRow({
  group,
  media,
  last,
  onConfirm,
  onReject,
}: {
  group: UnmatchedGroup;
  media: Media | undefined;
  last: boolean;
  onConfirm: (key: TitleKey, mediaId: number) => void;
  onReject: (key: TitleKey) => void;
}) {
  const { t } = useTranslation();
  const key = { title: group.title, season: group.season };
  const guess = group.suggestion!;
  const exact = guess.score >= EXACT;

  return (
    <div
      className={cn(
        "flex items-center gap-3.5 bg-surface-900/60 px-3.5 py-2 transition-surface hover:bg-surface-850",
        !last && "border-b border-surface-950",
      )}
    >
      <div className="dense-row-cover shrink-0 overflow-hidden rounded-inner bg-surface-800 opacity-60">
        {media?.coverImage.large && (
          <img
            src={media.coverImage.large}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        )}
      </div>

      <span className="min-w-0 flex-1">
        {/* Both names, because judging the guess means comparing the parsed title with the suggestion. */}
        <span className="dense-text-lg block truncate text-ink-500">
          {group.title}
          {group.season > 0 && (
            <span className="ml-1.5 text-2xs text-ink-600">S{group.season}</span>
          )}
          <span className="mx-1.5 text-ink-600">→</span>
          <span className="font-medium text-ink-300">
            {media ? displayTitle(media.title) : `#${guess.mediaId}`}
          </span>
        </span>
        <span className="dense-text block truncate text-ink-600">
          {t("library.fileCount", { n: group.files.length })}
        </span>
      </span>

      <span
        className={cn("shrink-0 text-xs", exact ? "text-ink-500" : "text-gold")}
        title={`${Math.round(guess.score * 100)}%`}
      >
        {t(exact ? "library.matchExact" : "library.matchClose")}
      </span>

      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => onReject(key)}
      >
        {t("library.notThis")}
      </Button>
      <Button
        size="sm"
        className="shrink-0"
        onClick={() => onConfirm(key, guess.mediaId)}
      >
        <Check className="size-3" />
        {t("library.confirm")}
      </Button>
    </div>
  );
}

/** Files the scanner read but could not place, so a missing show does not look like one never on disk. */
function Unplaced({
  groups,
  scrollRef,
  onAssign,
}: {
  groups: { title: string; season: number; files: LibraryFile[] }[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onAssign: (key: TitleKey) => void;
}) {
  const density = useTheme((s) => s.density);
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");

  // Parsed release titles are where typos live, so the filter matches them fuzzily and orders by score.
  const docs = useMemo(
    () => new Map(groups.map((g) => [g, prepareDoc([g.title])] as const)),
    [groups],
  );
  const matching = useMemo(() => {
    const q = filter.trim();
    if (!q) return groups;
    const pq = prepareQuery(q);
    return groups
      .map((g) => ({ g, score: fuzzyScore(docs.get(g)!, pq) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.g);
  }, [groups, docs, filter]);

  if (groups.length === 0) return null;

  // Most of these are extras that match nothing; a few show by default and the filter reaches the rest.
  const shown = expanded || filter ? matching : matching.slice(0, 5);
  const hidden = matching.length - shown.length;

  return (
    <section className="pt-6">
      <div className="mb-3 flex items-center gap-3">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[.12em] text-ink-600">
          <HelpCircle className="size-3.25" />
          {t("library.unplaced", { n: groups.length })}
        </p>
        {groups.length > 5 && (
          <SearchField
            size="sm"
            value={filter}
            onChange={setFilter}
            label={t("library.filterUnplaced")}
            clearLabel={t("common.clear")}
            placeholder={t("library.filterUnplaced")}
            className="ml-auto w-56"
          />
        )}
      </div>

      {matching.length === 0 && (
        <p className="rounded-panel border border-hair px-3.5 py-4 text-center text-xs text-ink-600">
          {t("library.noUnplacedMatch")}
        </p>
      )}
      <VirtualRows
        items={shown}
        scrollRef={scrollRef}
        estimateRowHeight={ROW_HEIGHT[density]}
        getKey={(group) => `${group.title}:${group.season}`}
        className="overflow-hidden rounded-panel border border-hair"
        renderItem={(group, _i, isLast) => (
          <div
            className={cn(
              "flex items-center gap-3.5 bg-surface-900 px-3.5 py-2 transition-surface hover:bg-surface-850",
              !isLast && "border-b border-surface-950",
            )}
          >
            <span className="dense-row-cover grid shrink-0 place-items-center rounded-inner bg-surface-800 text-ink-600">
              <HelpCircle className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="dense-text-lg block truncate font-medium text-ink-300">
                {group.title}
                {group.season > 0 && (
                  <span className="ml-1.5 text-2xs text-ink-600">
                    S{group.season}
                  </span>
                )}
              </span>
              <span className="dense-text block truncate text-ink-600">
                {fileName(group.files[0]?.path ?? "")}
              </span>
            </span>
            <span className="shrink-0 text-2xs tabular-nums text-ink-600">
              {t("library.fileCount", { n: group.files.length })}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => onAssign({ title: group.title, season: group.season })}
            >
              <Wand2 className="size-3" />
              {t("library.assign")}
            </Button>
          </div>
        )}
      />
      {!filter && (hidden > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-2xs font-medium text-accent-400 hover:underline"
        >
          {expanded
            ? t("library.showFewer")
            : t("library.showAllUnplaced", { n: hidden })}
        </button>
      )}
    </section>
  );
}


/** What opening the picker on a row needs to know. */
type Correction = { key: TitleKey; current?: string; hasOverride: boolean };

/** One captioned block of rows, in a single bordered container. */
function Group({
  label,
  rows,
  muted = false,
  scrollRef,
  expanded,
  onToggle,
  onCorrect,
  onAdd,
  onSplit,
}: {
  label: string;
  rows: Row[];
  muted?: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  expanded: ReadonlySet<number>;
  onToggle: (mediaId: number) => void;
  onCorrect: (c: Correction) => void;
  onAdd: (media: Media) => void;
  onSplit: (t: SplitTarget) => void;
}) {
  const density = useTheme((s) => s.density);
  if (rows.length === 0) return null;
  return (
    <section className="pt-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-[.12em] text-ink-600">
        {label}
      </p>
      <VirtualRows
        items={rows}
        scrollRef={scrollRef}
        estimateRowHeight={ROW_HEIGHT[density]}
        getKey={(row) => row.lib.mediaId}
        className="overflow-hidden rounded-panel border border-hair"
        renderItem={(row, _i, isLast) => (
          <LibraryRow
            row={row}
            muted={muted}
            last={isLast}
            open={expanded.has(row.lib.mediaId)}
            onToggle={onToggle}
            onCorrect={onCorrect}
            onAdd={onAdd}
            onSplit={onSplit}
          />
        )}
      />
    </section>
  );
}

/** The collapsed row height per density, the virtualizer's first guess; keep the divider in it or the scrollbar creeps. */
const ROW_HEIGHT: Record<Density, number> = { compact: 69, comfortable: 81, spacious: 93 };

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

function LibraryRow({
  row,
  muted,
  last,
  open,
  onToggle,
  onCorrect,
  onAdd,
  onSplit,
}: {
  row: Row;
  muted: boolean;
  /** Virtualized rows are absolutely positioned, so `last:` cannot see which one closes the card. */
  last: boolean;
  /** Owned by the page: a row scrolled out of view is unmounted, and state held here would go with it. */
  open: boolean;
  onToggle: (mediaId: number) => void;
  onCorrect: (c: Correction) => void;
  onAdd: (media: Media) => void;
  onSplit: (t: SplitTarget) => void;
}) {
  const { t } = useTranslation();
  const playEpisode = useLibrary((s) => s.playEpisode);
  const { lib, media, entry, next } = row;
  const title = displayTitle(media.title);
  // A zero is no match on record, not a bad one; an index without confidences must not read "close".
  const scored = lib.score > 0;
  const exact = lib.score >= EXACT;
  // Corrections key on the parse, so a merged row offers its corrected one; clearing another deletes nothing.
  const source = lib.sources?.find((s) => s.manual) ?? lib.sources?.[0];

  return (
    <div
      className={cn(
        "bg-surface-900 transition-surface hover:bg-surface-850",
        !last && "border-b border-surface-950",
      )}
    >
      <div className="flex items-center gap-3.5 px-3.5 py-2">
        <Link to={`/media/${lib.mediaId}`} className="shrink-0">
          <div className="dense-row-cover overflow-hidden rounded-inner bg-surface-800">
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
            className="dense-text-lg block truncate font-medium text-ink-100 hover:text-accent-400"
          >
            {title}
          </Link>
          {/* The file name, not a summary: this is the one screen where the name on disk is the subject. */}
          <span className="dense-text block truncate text-ink-600">
            {next
              ? fileName(next.path)
              : t("library.watchedOf", {
                  progress: entry?.progress ?? 0,
                  total: media.episodes ?? lib.episodes.length,
                })}
          </span>
        </span>

        {/* Not on the list, so nothing scrobbles; the scrobbler takes its candidates from the cached list alone. */}
        {!entry && (
          <button
            type="button"
            onClick={() => onAdd(media)}
            title={t("library.notOnListHint")}
            className="shrink-0 rounded-inner border border-surface-700 px-2 py-1 text-2xs text-ink-500 transition-surface hover:border-accent-500 hover:text-accent-400"
          >
            {t("library.addToList")}
          </button>
        )}

        <button
          type="button"
          onClick={() => onToggle(lib.mediaId)}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1 rounded-inner px-1.5 py-1 text-2xs tabular-nums text-ink-600 transition-surface hover:bg-surface-800 hover:text-ink-300"
        >
          {t("library.fileCount", { n: lib.files.length })}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>

        {/* The folder holds more than the show; the user decides, so this chip only opens the split card. */}
        {lib.overflow && (
          <button
            type="button"
            onClick={() =>
              onSplit({
                mediaId: lib.mediaId,
                title,
                overflow: lib.overflow!,
                maxEpisode: lib.episodes[lib.episodes.length - 1] ?? lib.overflow!.firstExtra,
              })
            }
            title={t("library.overflowHint")}
            className="shrink-0 rounded-inner border border-gold/40 bg-gold/10 px-1.5 py-1 text-2xs tabular-nums text-gold transition-surface hover:bg-gold/20"
          >
            {t("library.overflowChip", {
              files: lib.episodes.length,
              episodes: lib.overflow.knownEpisodes,
            })}
          </button>
        )}

        {/* The match and the way to disagree; a row with no source parse has nothing to key on and stays a label. */}
        {source ? (
          <button
            type="button"
            onClick={() =>
              onCorrect({
                key: source,
                current: title,
                hasOverride: source.manual ?? false,
              })
            }
            title={t("library.correctHint", { title: source.title })}
            className={cn(
              "group/match w-24 shrink-0 rounded-inner px-1.5 py-1 text-right text-xs transition-surface hover:bg-surface-800",
              lib.manual ? "text-accent-400" : exact ? "text-ink-500" : "text-gold",
            )}
          >
            <span className="group-hover/match:hidden">
              {lib.manual
                ? t("library.matchManual")
                : scored
                  ? t(exact ? "library.matchExact" : "library.matchClose")
                  : t("library.correct")}
            </span>
            <span className="hidden text-accent-400 group-hover/match:inline">
              {t("library.correct")}
            </span>
          </button>
        ) : (
          <span
            className={cn(
              "w-24 shrink-0 px-1.5 text-right text-xs",
              exact ? "text-ink-500" : "text-gold",
            )}
          >
            {scored ? t(exact ? "library.matchExact" : "library.matchClose") : ""}
          </span>
        )}

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

      {/* Every episode on disk, one click away, because playing out of order is worth keeping. */}
      {open && (
        <div className="flex flex-wrap gap-1.5 border-t border-surface-950 px-3.5 py-2.5 pl-[3.9375rem]">
          {lib.files.map((file) => {
            // No list entry means no recorded progress, so every episode is offered as unseen rather than greyed.
            const watched = file.episode <= (entry?.progress ?? 0);
            return (
              <button
                key={file.episode}
                onClick={() => playEpisode(lib.mediaId, file.episode)}
                title={fileName(file.path)}
                aria-label={t("library.playEpisode", { n: file.episode })}
                className={cn(
                  "flex items-center gap-1 rounded-inner px-2 py-1 text-xs font-medium tabular-nums transition-surface",
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
