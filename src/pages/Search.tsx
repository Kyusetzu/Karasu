import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useColumnCount } from "@/hooks/useColumnCount";
import { useGridRoving } from "@/hooks/useGridRoving";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { backendErrorText } from "@/lib/backendError";
import { Search as SearchIcon } from "lucide-react";
import {
  browseMedia,
  genreTagCollections,
  MEDIA_SOURCES,
  type BrowseFilters,
  type MediaWithListStatus,
  type Season,
} from "@/api/queries";
import { EMPTY, encode, isEmpty, toQueryArgs } from "@/lib/multiFilter";
import { MultiFilterSelect } from "@/components/ui/multi-filter-select";
import type { MediaType } from "@/api/types";
import { searchUsers, USER_SEARCH_MIN } from "@/api/social";
import {
  formatLabel,
  MEDIA_FORMATS,
  mediaStatusLabel,
  ORIGINS,
  originLabel,
  sourceLabel,
} from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/filter-select";
import MediaCard from "@/components/media/MediaCard";
import { isTauri } from "@/api/anilist";
import { adultQueryArg, isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { useAuth } from "@/stores/auth";
import { EmptyState, PerchRule, StruckQuery } from "@/components/EmptyState";
import { Pill } from "@/components/ui/pill";
import { UserList } from "@/components/social/UserList";

/**
 * What the search is looking for. The comment on the pills below always said
 * the two mediums were "one choice among several the search will grow" — people
 * are the third.
 */
type Scope = MediaType | "USERS";

const SEASONS: Season[] = ["WINTER", "SPRING", "SUMMER", "FALL"];
const STATUSES = ["RELEASING", "FINISHED", "NOT_YET_RELEASED", "CANCELLED", "HIATUS"];
/** The sorts worth offering; relevance only means something with a query. */
const SORTS = ["SEARCH_MATCH", "TRENDING_DESC", "POPULARITY_DESC", "SCORE_DESC", "START_DATE_DESC"];

/** Literal switch, so `i18nKeys.test.ts` sees every key. */
function sortLabel(sort: string, t: (k: string) => string): string {
  switch (sort) {
    case "SEARCH_MATCH":
      return t("search.sortRelevance");
    case "TRENDING_DESC":
      return t("search.sortTrending");
    case "POPULARITY_DESC":
      return t("search.sortPopularity");
    case "SCORE_DESC":
      return t("search.sortScore");
    case "START_DATE_DESC":
      return t("search.sortNewest");
    default:
      return sort;
  }
}

/** The ready-made lenses — a browse page's worth of charts as one click. */
const BROWSE_CHIPS = [
  { key: "chipTrending", sort: "TRENDING_DESC", thisSeason: false },
  { key: "chipSeason", sort: "POPULARITY_DESC", thisSeason: true },
  { key: "chipPopular", sort: "POPULARITY_DESC", thisSeason: false },
  { key: "chipTop", sort: "SCORE_DESC", thisSeason: false },
] as const;

function currentSeasonOf(now = new Date()): { season: Season; year: number } {
  const month = now.getMonth() + 1;
  const season: Season =
    month <= 3 ? "WINTER" : month <= 6 ? "SPRING" : month <= 9 ? "SUMMER" : "FALL";
  return { season, year: now.getFullYear() };
}

export default function Search() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [scope, setScope] = useState<Scope>("ANIME");
  // Include *and* exclude, many at a time — `Page.media` takes `genre_in` /
  // `genre_not_in` and the tag pair, which is what AniList's own browse page
  // is built on. One genre and one tag was a lens, not a filter.
  const [genre, setGenre] = useState(EMPTY);
  const [tag, setTag] = useState(EMPTY);
  const [year, setYear] = useState("");
  const [season, setSeason] = useState("");
  const [format, setFormat] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [country, setCountry] = useState("");
  const [sort, setSort] = useState("SEARCH_MATCH");
  const type: MediaType = scope === "USERS" ? "ANIME" : scope;

  // Debounce: search only after 500 ms of typing pause (spare the rate limit)
  useEffect(() => {
    const timer = setTimeout(() => setTerm(input.trim()), 500);
    return () => clearTimeout(timer);
  }, [input]);

  // A format from the other medium is meaningless after a scope flip.
  useEffect(() => setFormat(""), [scope]);

  const level = useContentFilter((s) => s.level);
  const filterReady = useContentFilter((s) => s.ready);

  // The vocabularies AniList defines. One request, effectively permanent.
  const collections = useQuery({
    queryKey: ["genreTags"],
    queryFn: genreTagCollections,
    enabled: isTauri,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const genres = collections.data?.genres ?? [];
  const tags = useMemo(
    () =>
      (collections.data?.tags ?? [])
        .filter((x) => level === "off" || x.isAdult !== true)
        .map((x) => x.name)
        .sort(),
    [collections.data, level],
  );

  const hasFilters =
    !isEmpty(genre) ||
    !isEmpty(tag) ||
    !!(year || season || format || status || source || country);
  // Relevance without a query is meaningless; popularity is the browse default.
  const effectiveSort = term || sort !== "SEARCH_MATCH" ? sort : "POPULARITY_DESC";
  const active = term.length >= 2 || hasFilters;

  const genreArgs = toQueryArgs(genre);
  const tagArgs = toQueryArgs(tag);
  const filters: BrowseFilters = {
    search: term.length >= 2 ? term : undefined,
    genreIn: genreArgs.in,
    genreNotIn: genreArgs.notIn,
    tagIn: tagArgs.in,
    tagNotIn: tagArgs.notIn,
    seasonYear: year ? Number(year) : undefined,
    season: (season || undefined) as Season | undefined,
    format: format || undefined,
    status: status || undefined,
    source: source || undefined,
    countryOfOrigin: country || undefined,
    sort: term.length >= 2 ? sort : effectiveSort,
  };

  const media = useInfiniteQuery({
    // The level is part of the key: changing it must refetch, since the
    // filtering happens server-side.
    //
    // Genre and tag go in *encoded*, not as arrays: `encode` sorts both sides,
    // so picking the same two genres in a different order is one cache entry
    // rather than two byte-identical requests.
    queryKey: [
      "search",
      type,
      term,
      encode(genre),
      encode(tag),
      year,
      season,
      format,
      status,
      source,
      country,
      filters.sort,
      level,
    ],
    queryFn: ({ pageParam }) => browseMedia(type, filters, pageParam, adultQueryArg(level)),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.pageInfo.hasNextPage ? all.length + 1 : undefined),
    enabled: isTauri && filterReady && active && scope !== "USERS",
    staleTime: 5 * 60 * 1000,
  });

  // Server-side isAdult covers explicit works; the strict level additionally
  // drops Ecchi, which AniList does not flag as adult.
  const results = (media.data?.pages ?? [])
    .flatMap((p) => p.media)
    .filter((m) => !isBlocked(m, level));

  const applyChip = (chip: (typeof BROWSE_CHIPS)[number]) => {
    const now = currentSeasonOf();
    setInput("");
    setTerm("");
    setGenre(EMPTY);
    setTag(EMPTY);
    setStatus("");
    setFormat("");
    setSource("");
    setCountry("");
    setSort(chip.sort);
    setYear(chip.thisSeason ? String(now.year) : "");
    setSeason(chip.thisSeason ? now.season : "");
  };

  const yearOptions = useMemo(() => {
    const max = new Date().getFullYear() + 1;
    return Array.from({ length: max - 1939 }, (_, i) => String(max - i));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="px-8 pt-6">
        <h1 className="text-2xl font-bold">{t("search.title")}</h1>
        <div className="mt-4 max-w-176">
          <div className="relative max-w-136">
            <SearchIcon
              className="pointer-events-none absolute left-3 top-1/2 size-3.75 -translate-y-1/2 text-ink-600"
            />
            <Input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("search.placeholder")}
              onClear={() => setInput("")}
              clearLabel={t("common.clear")}
              className="h-11 pl-9"
            />
          </div>
          {/* Chips rather than a segmented control: this was written when there
              were two mediums and called them "one choice among several the
              search will grow". People are the third, and the chips took it
              without a layout change — which is what the shape was chosen for. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {(["ANIME", "MANGA", "USERS"] as const).map((sc) => (
              <Pill key={sc} active={scope === sc} onClick={() => setScope(sc)}>
                {sc === "ANIME"
                  ? t("search.anime")
                  : sc === "MANGA"
                    ? t("search.manga")
                    : t("search.users")}
              </Pill>
            ))}
            {scope !== "USERS" && (
              <>
                <span className="mx-1 h-4 w-px bg-surface-700" />
                {BROWSE_CHIPS.map((chip) => (
                  <Pill key={chip.key} onClick={() => applyChip(chip)}>
                    {t(`search.${chip.key}`)}
                  </Pill>
                ))}
              </>
            )}
          </div>
          {scope !== "USERS" && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              <MultiFilterSelect
                label={t("search.genreLabel")}
                value={genre}
                onChange={setGenre}
                placeholder={t("search.any")}
                options={genres}
              />
              {/* Searchable: AniList ships roughly six hundred tags, which is
                  a scroll rather than a list. */}
              <MultiFilterSelect
                label={t("search.tagLabel")}
                value={tag}
                onChange={setTag}
                placeholder={t("search.any")}
                options={tags}
                searchable
              />
              <FilterSelect
                label={t("search.yearLabel")}
                value={year}
                onChange={setYear}
                placeholder={t("search.any")}
                options={yearOptions.map((y) => ({ value: y, label: y }))}
              />
              {scope === "ANIME" && (
                <FilterSelect
                  label={t("search.seasonLabel")}
                  value={season}
                  onChange={setSeason}
                  placeholder={t("search.any")}
                  options={SEASONS.map((s) => ({
                    value: s,
                    label: t(`season.${s}`, { defaultValue: s }),
                  }))}
                />
              )}
              <FilterSelect
                label={t("list.formatLabel")}
                value={format}
                onChange={setFormat}
                placeholder={t("search.any")}
                options={MEDIA_FORMATS[type].map((f) => ({
                  value: f,
                  label: formatLabel(f, t),
                }))}
              />
              <FilterSelect
                label={t("search.statusLabel")}
                value={status}
                onChange={setStatus}
                placeholder={t("search.any")}
                options={STATUSES.map((s) => ({
                  value: s,
                  label: mediaStatusLabel(s, t),
                }))}
              />
              {/* `sourceLabel` and `originLabel` are `lib/format`'s, not this
                  file's: both already shipped with their labels in both
                  languages, and a second copy is how "Manhua (China)" ends up
                  spelled two ways. */}
              <FilterSelect
                label={t("search.sourceLabel")}
                value={source}
                onChange={setSource}
                placeholder={t("search.any")}
                options={MEDIA_SOURCES.map((s) => ({
                  value: s,
                  label: sourceLabel(s, t),
                }))}
              />
              <FilterSelect
                label={t("list.originLabel")}
                value={country}
                onChange={setCountry}
                placeholder={t("search.any")}
                options={ORIGINS.map((c) => ({
                  value: c,
                  label: originLabel(c, t),
                }))}
              />
              <FilterSelect
                label={t("list.sortLabel")}
                value={filters.sort}
                onChange={setSort}
                options={SORTS.map((s) => ({ value: s, label: sortLabel(s, t) }))}
              />
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {scope === "USERS" && <UserSearchResults term={term} />}
        {scope !== "USERS" && (
          <MediaResults
            error={media.error}
            isFetching={media.isFetching && !media.isFetchingNextPage}
            active={active}
            term={term}
            results={results}
            hasNextPage={media.hasNextPage === true}
            fetchingMore={media.isFetchingNextPage}
            onMore={() => media.fetchNextPage()}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Users need a longer query than media.
 *
 * Two characters make AniList return the exact match followed by a fixed set of
 * unrelated accounts, so the threshold is three — the point at which it starts
 * answering with real prefix matches. Media search is fine at two and keeps it.
 */
function UserSearchResults({ term }: { term: string }) {
  const { t } = useTranslation();
  const mode = useAuth((s) => s.mode);

  if (mode !== "anilist") {
    return (
      <EmptyState
        visual={<PerchRule />}
        title={t("social.needsAccount")}
        hint={t("social.needsAccountHint")}
      />
    );
  }

  if (term.length < USER_SEARCH_MIN) {
    return (
      <EmptyState
        title={t("search.userPrompt")}
        hint={t("search.userPromptHint", { n: USER_SEARCH_MIN })}
      />
    );
  }

  return (
    <UserList
      queryKey={["social", "userSearch", term]}
      fetchPage={(page) => searchUsers(term, page)}
      emptyTitle={t("search.noUsers")}
      emptyHint={t("search.noUsersHint")}
      // AniList's `total` is a capped 5000 here, so a count would be invented.
      countRemaining={false}
      staleTime={5 * 60 * 1000}
    />
  );
}

function MediaResults({
  error,
  isFetching,
  active,
  term,
  results,
  hasNextPage,
  fetchingMore,
  onMore,
}: {
  error: unknown;
  isFetching: boolean;
  /** Whether anything — a query or a filter — is asking for results. */
  active: boolean;
  term: string;
  results: MediaWithListStatus[];
  hasNextPage: boolean;
  fetchingMore: boolean;
  onMore: () => void;
}) {
  const { t } = useTranslation();

  // Arrow keys over the wall of cards, the same movement and the same
  // ownership rule the list view uses. `useColumnCount` reads the browser's
  // resolved `grid-template-columns` rather than recomputing the CSS here,
  // which is what keeps it right across a breakpoint and a cover-size change.
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = useColumnCount(gridRef, results.length);
  const navigate = useNavigate();
  const { focus } = useGridRoving({
    count: results.length,
    columns,
    onOpen: (i) => {
      const m = results[i];
      if (m) navigate(`/media/${m.id}`);
    },
  });
  return (
    <>
      {error != null && (
        <p className="text-sm text-danger">
          {/* Through the code translator: a backend error is a stable code
              (`anilist.tokenRejected` reached users verbatim here), and
              `backendErrorText` turns known codes into sentences. */}
          {t("common.error", { message: backendErrorText(error, t) })}
        </p>
      )}
      {isFetching && (
        <p className="text-sm text-ink-600">{t("search.searching")}</p>
      )}
      {!isFetching && !active && (
        // No mark here, deliberately: on every other empty screen the visual
        // is the subject, and on this one the field above it is.
        <EmptyState title={t("search.prompt")} hint={t("search.promptHint")} />
      )}
      {!isFetching && active && results.length === 0 && (
        <EmptyState
          visual={<StruckQuery query={term || t("search.filtered")} />}
          // The query is already on screen at 2.5rem — repeating it in the
          // sentence underneath just says the same thing twice.
          title={t("search.noResults")}
          hint={t("search.noResultsHint")}
        />
      )}
      {results.length > 0 && (
        <>
          <div ref={gridRef} className="media-grid gap-x-4 gap-y-6">
            {results.map((m, i) => (
              <MediaCard key={m.id} media={m} focused={i === focus} />
            ))}
          </div>
          {hasNextPage && (
            <div className="mt-6 flex justify-center">
              {/* Countless, per the house rule: `pageInfo.total` is the
                  capped sentinel on search, so a number would be invented. */}
              <Button variant="outline" size="control" onClick={onMore} disabled={fetchingMore}>
                {t("social.loadMorePlain")}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
