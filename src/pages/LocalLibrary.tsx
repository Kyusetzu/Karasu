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
import {
  Check,
  ChevronDown,
  FolderOpen,
  HelpCircle,
  Play,
  RefreshCw,
  Search,
  Wand2,
  X,
} from "lucide-react";
import { fetchMediaList, isTauri, saveListEntry } from "@/api/anilist";
import { mediaByIds } from "@/api/queries";
import { displayTitle, type Media, type MediaListEntry } from "@/api/types";
import { missingIds } from "@/lib/chunk";
import { fuzzyScore, prepareDoc, prepareQuery } from "@/lib/fuzzy";
import { loadDefaultAddStatus } from "@/lib/defaultAddStatus";
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

/**
 * Above this the matcher hit the title exactly; below it, it guessed.
 *
 * `best_match_prepared` returns exactly `1.0` from its string-equality short
 * circuit, so this is a test for that branch rather than a tolerance.
 */
const EXACT = 0.999;

/// Hoisted for the same measured reason as MediaList's — see the note there.
/// Options left at the defaults so the ordering matches what `localeCompare()`
/// produced.
const COLLATOR = new Intl.Collator();

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
  /**
   * The list entry, when there is one. A manual match can point files at a
   * title the user has never added — indeed that is the usual case, since a
   * title absent from the list is exactly what the matcher could not place —
   * and such a row has no progress, no status and nothing to scrobble against.
   */
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

  // The full index is fetched here rather than at startup — this is the only
  // screen that reads the paths and scores in it.
  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

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

  // Every id the list holds, blocked ones included. `byMedia` cannot answer
  // "is this on the list?" because a content-filtered title is deliberately
  // missing from it — asking that one would send us to AniList to fetch the
  // very titles the filter exists to keep off this screen.
  const onList = useMemo(() => {
    const ids = new Set<number>();
    for (const group of data?.lists ?? []) {
      if (group.isCustomList) continue;
      for (const e of group.entries) ids.add(e.mediaId);
    }
    return ids;
  }, [data]);

  // Library ids with no cached list entry. Sorted and de-duplicated, because
  // this array is a query key: an unsorted one reshuffles on every render and
  // mints a fresh key each time, which defeats the cache it is meant to use.
  const offList = useMemo(
    () => missingIds(entries.map((e) => e.mediaId), onList),
    [entries, onList],
  );

  // `placeholderData` is what keeps the section on screen while it refetches.
  // The key is the whole id set, so confirming one suggestion mints a new key,
  // and a new key has no cached data — without this the entire "detected but
  // not on the list" section blanks for a round trip after every correction,
  // which reads as having deleted the row rather than moved it.
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

  // Why each blocked ON-LIST id is hidden. `byMedia` deliberately lacks these
  // rows, so their absence used to be countable but not explainable — the
  // reason has to come from the list data itself.
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

  // What the filter kept off this screen, by reason: blocked on-list titles,
  // plus off-list titles AniList resolved as blocked. Counted from the same
  // structures the rows are built from, so the line and the list cannot
  // disagree.
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
      // A row needs a title to draw. It comes from the list when the title
      // is on it and from AniList directly when it is not; only an id that
      // AniList itself does not know leaves us with nothing to show.
      const media = entry?.media ?? byId.get(lib.mediaId);
      if (!media) return [];
      if (isBlocked(media, level)) return [];
      const progress = entry?.progress ?? 0;
      const next = lib.files.find((f) => f.episode > progress) ?? null;
      return [{ lib, media, entry, next }];
    });
    // Titles resolved once and the collator hoisted, the same way MediaList
    // does it: `localeCompare` builds a fresh collator per call, and both it
    // and `displayTitle` were being run twice per comparison — n·log n times
    // over a library that can hold thousands of titles, re-run on every
    // rescan, every correction and every content-filter change.
    const titles = new Map(built.map((r) => [r.lib.mediaId, displayTitle(r.media.title)]));
    return built.sort((a, b) =>
      COLLATOR.compare(
        titles.get(a.lib.mediaId) ?? "",
        titles.get(b.lib.mediaId) ?? "",
      ),
    );
  }, [entries, byMedia, byId, level]);

  // Files the scanner could not place. Kept in the cache next to the status so
  // one rescan invalidates both.
  const { data: unmatched, refetch: refetchUnmatched } = useQuery({
    queryKey: ["libraryUnmatched"],
    queryFn: getLibraryUnmatched,
    enabled: isTauri,
  });

  // A group with a suggestion is something AniList recognised; without one it
  // is a genuine failure. The two get their own sections, because "we think
  // this is Hunter x Hunter, confirm?" and "we have no idea what this is" are
  // different questions and only one of them has an answer to check.
  const suggested = useMemo(
    () => (unmatched ?? []).filter((g) => g.suggestion),
    [unmatched],
  );

  // Covers and titles for the suggested media, fetched the same way the
  // off-list rows are.
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

  // A suggestion is the one row on this screen AniList picked rather than the
  // user, and nothing upstream filters it: the identify pass asks by title with
  // no `isAdult` constraint. Filtering only the confirmed rows would invert the
  // guarantee — accept the guess and the title vanishes, leave it and it shows.
  // Blocking on unresolved media would be wrong the other way, so an id whose
  // media has not arrived yet stays visible as the bare `#id` placeholder.
  //
  // A blocked guess demotes the group to "failed" rather than deleting it. The
  // files are still on disk and still unplaced, and the suggestion row is the
  // only thing that carries "Not this" — dropping the group outright would
  // take away the one way to say the guess was wrong, and with it the only
  // route to the picker. Unplaced prints the parsed filename, never the
  // AniList title, so nothing blocked reaches the screen.
  const blocked = useCallback(
    (g: UnmatchedGroup) =>
      !!g.suggestion && isBlocked(suggestedById.get(g.suggestion.mediaId), level),
    [suggestedById, level],
  );
  const visibleSuggestions = useMemo(
    () => suggested.filter((g) => !blocked(g)),
    [suggested, blocked],
  );
  const failed = useMemo(
    () => (unmatched ?? []).filter((g) => !g.suggestion || blocked(g)),
    [unmatched, blocked],
  );

  // The scroll container every section virtualizes against, and which rows
  // are expanded.
  //
  // The expand state used to be a `useState` inside `LibraryRow`. Virtualizing
  // unmounts a row that scrolls out of view, which would have taken that state
  // with it: expand a row, scroll past it, come back, and it had quietly
  // closed. Held here it survives, because the page outlives the row.
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

  // What the picker is currently open on: either a row being corrected or an
  // unplaced group being assigned. One piece of state, because only one of
  // them can be open at a time and two would let both be.
  const [editing, setEditing] = useState<{
    key: TitleKey;
    current?: string;
    hasOverride: boolean;
  } | null>(null);

  // A correction that fails must not look like one that did nothing. Both of
  // these used to let a rejected command fall on the floor: the dialog stayed
  // open, no row moved, and there was no way to tell a backend error from a
  // successful no-op.
  //
  // The reason belongs *in* the dialog. On failure the picker stays mounted at
  // z-110, so routing this through the app-level playback banner would draw the
  // explanation in the far corner, under the picker's own scrim, and clear it
  // after six seconds.
  // Not every correction comes from the dialog, though: confirming a
  // suggestion is one click on the row itself, and reporting *that* failure
  // into a picker that is not open would lose it entirely. Such callers pass
  // the app-level banner instead, which is the only thing on screen for them.
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

  // The season-split card: which overflowing row it is open on, and its own
  // error line — the same reasoning as `correctError`, the reason belongs *in*
  // the dialog that stays mounted over everything else.
  const [splitting, setSplitting] = useState<SplitTarget | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [splitPending, setSplitPending] = useState(false);
  const applySplit = useCallback(
    async (mediaId: number, dstStart: number, label: string) => {
      if (!splitting) return;
      setSplitError(null);
      setSplitPending(true);
      try {
        // Keyed on the row and its displayed numbers; the backend resolves
        // the files, so a chained split cannot target the wrong ones.
        await setLibraryRedirect(
          splitting.mediaId,
          splitting.overflow.firstExtra,
          splitting.maxEpisode,
          mediaId,
          dstStart,
        );
        setSplitting(null);
        // The visible confirmation the third split was missing: the row often
        // barely changes, so the toast is what says the answer landed.
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

  // Accepting a suggestion is an ordinary correction — the same command, the
  // same override row. The only difference is that the answer came from a
  // search rather than from the picker.
  const confirmSuggestion = useCallback(
    (key: TitleKey, mediaId: number) =>
      runCorrection(
        () => setLibraryMatch(key.title, key.season, mediaId),
        setError,
      ),
    [runCorrection, setError],
  );

  // Adding a corrected title to the list is what makes it trackable: the
  // scrobbler builds its candidates from the cached list (`candidates_from_cache`),
  // so a title that is not on it can be played from here all evening and never
  // record a thing.
  //
  // The whole media object, not just the id: every row here is by definition
  // absent from the list, and `local_save_entry` has no row to read a type off,
  // so a local-profile add without it is rejected outright. And the invalidate
  // is what moves the row — `useListMutations` patches entries that already
  // exist, which a first add never does, so this path cannot use it.
  const qc = useQueryClient();
  const addToList = useCallback(
    async (media: Media) => {
      try {
        await saveListEntry(
          { mediaId: media.id, status: loadDefaultAddStatus() },
          media,
        );
        await qc.invalidateQueries({ queryKey: ["mediaList", "ANIME", userId] });
      } catch (e) {
        setError(typeof e === "string" ? e : t("library.addFailed"));
      }
    },
    [qc, userId, setError, t],
  );

  // On the list, split into a list of things to do tonight and a list of
  // things already done. Titles that resolved but were never added are a
  // different state entirely and get their own section below.
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
    // This page has no error line of its own, so a rejection here has nowhere
    // to go but a toast — the alternative was an unhandled rejection and a
    // button that silently did nothing.
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

/**
 * Titles that resolved to an AniList show you have not added.
 *
 * Two kinds of row live here, and the difference is who decided. Confirmed
 * ones — corrections you made, suggestions you accepted — are ordinary rows
 * that play. Unconfirmed suggestions are greyed: AniList answered, but open
 * search returns *something* for almost any input, and its top hit for
 * "digimon" is a 2005 film rather than the series. Nothing moves until you say
 * so.
 */
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
  const { t } = useTranslation();
  // Two row shapes in one card, so they go through one virtualizer as a
  // tagged union rather than two — two would each measure their own start and
  // the second would sit on top of the first.
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
      <p className="mb-1 text-[.6875rem] font-medium uppercase tracking-[.12em] text-ink-600">
        {t("library.detectedOffList")}
      </p>
      <p className="mb-3 text-2xs text-ink-600">
        {t("library.detectedOffListHint")}
      </p>
      <VirtualRows
        items={items}
        scrollRef={scrollRef}
        estimateRowHeight={ROW_HEIGHT}
        getKey={(item) =>
          item.kind === "row"
            ? `r:${item.row.lib.mediaId}`
            : `s:${item.group.title}:${item.group.season}`
        }
        className="overflow-hidden rounded-xl border border-hair"
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
      <div className="h-13 w-8.75 shrink-0 overflow-hidden rounded-md bg-surface-800 opacity-60">
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
        {/* Both names, because judging the guess means comparing them. The
            parsed title alone cannot be checked and the suggestion alone hides
            what it was guessed from. */}
        <span className="block truncate text-[.8125rem] text-ink-500">
          {group.title}
          {group.season > 0 && (
            <span className="ml-1.5 text-2xs text-ink-600">S{group.season}</span>
          )}
          <span className="mx-1.5 text-ink-600">→</span>
          <span className="font-medium text-ink-300">
            {media ? displayTitle(media.title) : `#${guess.mediaId}`}
          </span>
        </span>
        <span className="block truncate text-[.6875rem] text-ink-600">
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

/**
 * Files the scanner read but could not place at all.
 *
 * Before this they were simply absent — the screen listed what matched and
 * said nothing about the rest, so a show missing from the library looked
 * identical to a show that was never on disk. The count in the path row was the
 * only hint that anything had been left behind, and it did not say what.
 */
function Unplaced({
  groups,
  scrollRef,
  onAssign,
}: {
  groups: { title: string; season: number; files: LibraryFile[] }[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onAssign: (key: TitleKey) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");

  // Parsed release titles are exactly where typos and odd spellings live, so
  // the filter matches them fuzzily and orders by how well.
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

  // A real library leaves over a hundred of these — mostly extras, specials and
  // one-off files that legitimately match nothing. Showing them all buries the
  // part of the screen that works, and showing five means correcting one just
  // promotes the next into view, which reads as nothing having happened.
  // Filtering is how you reach a specific show without either.
  const shown = expanded || filter ? matching : matching.slice(0, 5);
  const hidden = matching.length - shown.length;

  return (
    <section className="pt-6">
      <div className="mb-3 flex items-center gap-3">
        <p className="flex items-center gap-1.5 text-[.6875rem] font-medium uppercase tracking-[.12em] text-ink-600">
          <HelpCircle className="size-3.25" />
          {t("library.unplaced", { n: groups.length })}
        </p>
        {groups.length > 5 && (
          <div className="relative ml-auto w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-ink-600" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("library.filterUnplaced")}
              className="h-7 w-full rounded-md border border-surface-800 bg-surface-900 pl-7 pr-6 text-2xs text-ink-200 placeholder:text-ink-600 focus:border-accent-500 focus:outline-none"
            />
            {/* Hand-rolled rather than `IconButton`: its smallest size is
                1.75rem and this box is `h-7` (1.75rem), so the button would be
                the whole field. */}
            {filter && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setFilter("")}
                className="absolute right-1 top-1/2 grid size-4.5 -translate-y-1/2 place-items-center rounded text-ink-600 transition-surface hover:bg-surface-800 hover:text-ink-100"
              >
                <X className="size-2.75" />
                <span className="sr-only">{t("common.clear")}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {matching.length === 0 && (
        <p className="rounded-xl border border-hair px-3.5 py-4 text-center text-xs text-ink-600">
          {t("library.noUnplacedMatch")}
        </p>
      )}
      <VirtualRows
        items={shown}
        scrollRef={scrollRef}
        estimateRowHeight={ROW_HEIGHT}
        getKey={(group) => `${group.title}:${group.season}`}
        className="overflow-hidden rounded-xl border border-hair"
        renderItem={(group, _i, isLast) => (
          <div
            className={cn(
              "flex items-center gap-3.5 bg-surface-900 px-3.5 py-2 transition-surface hover:bg-surface-850",
              !isLast && "border-b border-surface-950",
            )}
          >
            <span className="grid h-13 w-8.75 shrink-0 place-items-center rounded-md bg-surface-800 text-ink-600">
              <HelpCircle className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[.8125rem] font-medium text-ink-300">
                {group.title}
                {group.season > 0 && (
                  <span className="ml-1.5 text-2xs text-ink-600">
                    S{group.season}
                  </span>
                )}
              </span>
              <span className="block truncate text-[.6875rem] text-ink-600">
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
  if (rows.length === 0) return null;
  return (
    <section className="pt-4">
      <p className="mb-3 text-[.6875rem] font-medium uppercase tracking-[.12em] text-ink-600">
        {label}
      </p>
      <VirtualRows
        items={rows}
        scrollRef={scrollRef}
        estimateRowHeight={ROW_HEIGHT}
        getKey={(row) => row.lib.mediaId}
        className="overflow-hidden rounded-xl border border-hair"
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

/**
 * Collapsed height of a row, for the virtualizer's first guess.
 *
 * `h-13` for the cover plus `py-2` above and below: 3.25rem + 1rem at the
 * 16px root the app pins. Only ever an estimate — every mounted row is
 * measured, which is what an expanded row's file list needs — but a wrong one
 * makes the scrollbar jump as you scroll into unmeasured territory.
 */
const ROW_HEIGHT = 68;

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
  /** Virtualized rows are absolutely positioned, so `last:` cannot see which
      one closes the card. */
  last: boolean;
  /** Owned by the page: a row scrolled out of view is unmounted, and state
      held here would go with it. */
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
  // A zero is not a bad match — it is *no* match on record. Only a scan writes
  // confidences, so an index carried over from a build before they existed has
  // none, and calling that "close" would be the screen inventing a judgement it
  // was never given.
  const scored = lib.score > 0;
  const exact = lib.score >= EXACT;
  // A row can be the merge of several parsed titles. Correcting it means
  // correcting the parse that produced it, so with more than one there is no
  // single answer — offer the corrected one if there is one, since that is the
  // parse "remove correction" has to be keyed on. Source order is walk order,
  // so picking the first would offer the auto-matched parse about as often as
  // not, and clearing that one deletes nothing.
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
            {next
              ? fileName(next.path)
              : t("library.watchedOf", {
                  progress: entry?.progress ?? 0,
                  total: media.episodes ?? lib.episodes.length,
                })}
          </span>
        </span>

        {/* Not on the list, so nothing here scrobbles: the scrobbler builds its
            candidates from the cached list and cannot see this title at all.
            The files still play — they just would not have recorded anything,
            which is worth saying out loud rather than leaving to be noticed. */}
        {!entry && (
          <button
            type="button"
            onClick={() => onAdd(media)}
            title={t("library.notOnListHint")}
            className="shrink-0 rounded-md border border-surface-700 px-2 py-1 text-2xs text-ink-500 transition-surface hover:border-accent-500 hover:text-accent-400"
          >
            {t("library.addToList")}
          </button>
        )}

        <button
          type="button"
          onClick={() => onToggle(lib.mediaId)}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-2xs tabular-nums text-ink-600 transition-surface hover:bg-surface-800 hover:text-ink-300"
        >
          {t("library.fileCount", { n: lib.files.length })}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>

        {/* The folder holds more than the show: almost always the next season
            under one folder name. Detection is the scanner's; the decision is
            the user's — this chip opens the split card, nothing more. */}
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
            className="shrink-0 rounded-md border border-gold/40 bg-gold/10 px-1.5 py-1 text-2xs tabular-nums text-gold transition-surface hover:bg-gold/20"
          >
            {t("library.overflowChip", {
              files: lib.episodes.length,
              episodes: lib.overflow.knownEpisodes,
            })}
          </button>
        )}

        {/* The match, and the way to disagree with it. A confidence the user
            cannot act on is just a number; the button is what makes saying
            "close" worth the width it takes.
            A row with no source parse — one restored from an index written
            before corrections existed — has nothing to key a correction on, so
            it stays a label until the next scan gives it one. */}
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
              "group/match w-24 shrink-0 rounded-md px-1.5 py-1 text-right text-xs transition-surface hover:bg-surface-800",
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

      {/* Every episode on disk, one click away. The design drops these for the
          next-file row, but playing something out of order is what this screen
          could already do and there is no reason to take it away. */}
      {open && (
        <div className="flex flex-wrap gap-1.5 border-t border-surface-950 px-3.5 py-2.5 pl-[3.9375rem]">
          {lib.files.map((file) => {
            // No list entry means no recorded progress, so nothing counts as
            // watched — every episode is offered as unseen rather than the
            // whole season being greyed out on a progress of zero it never had.
            const watched = file.episode <= (entry?.progress ?? 0);
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
