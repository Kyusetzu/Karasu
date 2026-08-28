import { memo, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { BarChart3, BookOpen, Cake, CalendarClock, CalendarDays, Play, Plus } from "lucide-react";
import { fetchMediaList, isTauri } from "@/api/anilist";
import { favouriteBirthdays } from "@/api/social";
import { birthdaysOn } from "@/lib/birthdays";
import { Avatar } from "@/components/ui/user-lockup";
import { displayTitle, maxProgress, type MediaListEntry, type MediaType } from "@/api/types";
import { useAuth, useScoreFormat } from "@/stores/auth";
import { formatMeanScore, formatScore } from "@/lib/scoreFormat";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked, shouldBlur } from "@/lib/contentFilter";
import { useListMutations } from "@/hooks/useListMutations";
import { canIncrement } from "@/components/list/shared";
import { fromList } from "@/lib/calendar";
import { SectionHeader } from "@/components/ui/section-header";
import { DigestRow } from "@/components/media/DigestRow";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { TitleLockup } from "@/components/media/TitleLockup";
import { CoverCell, CoverMeta } from "@/components/media/CoverCell";
import {
  EmptyState,
  PerchRule,
  TickMarks,
} from "@/components/EmptyState";
import FirstRun from "@/components/shell/FirstRun";
import {
  CoverGridSkeleton,
  HeaderSkeleton,
  Shimmer,
} from "@/components/Skeleton";
import NowPlayingCard from "@/components/media/NowPlayingCard";
import SeasonHero from "@/components/media/SeasonHero";
import RecommendedSection from "@/components/media/RecommendedSection";

export default function Dashboard() {
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const loading = useAuth((s) => s.loading);

  if (loading) return null;

  if (!viewer && mode !== "local") return <FirstRun />;

  return <DashboardContent userId={viewer?.id ?? 0} />;
}

function DashboardContent({ userId }: { userId: number }) {
  const { t } = useTranslation();
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["mediaList", "ANIME", userId],
    queryFn: () => fetchMediaList(userId, "ANIME"),
  });
  // Only the recommendation section needs the manga list; it is served from
  // the same Rust-side cache the manga list page already fills.
  const {
    data: mangaData,
    isLoading: mangaLoading,
    error: mangaError,
  } = useQuery({
    queryKey: ["mediaList", "MANGA", userId],
    queryFn: () => fetchMediaList(userId, "MANGA"),
  });
  const { save } = useListMutations(userId, "ANIME");
  const { save: mangaSave } = useListMutations(userId, "MANGA");
  const level = useContentFilter((s) => s.level);

  // One content-filtered base for every section below, so a new section can't
  // accidentally skip the check.
  const allAnime = useMemo(
    () =>
      data?.lists
        .filter((g) => !g.isCustomList)
        .flatMap((g) => g.entries)
        .filter((e) => !isBlocked(e.media, level)) ?? [],
    [data, level],
  );

  const allManga = useMemo(
    () =>
      mangaData?.lists
        .filter((g) => !g.isCustomList)
        .flatMap((g) => g.entries)
        .filter((e) => !isBlocked(e.media, level)) ?? [],
    [mangaData, level],
  );

  // Every section is its own component, so the running order below is a plain
  // list and rearranging it is a one-line move.
  //
  // The loading gate is not cosmetic. Every section renders an *empty state*
  // from an empty list, so without it a cold start claims "you are not watching
  // anything" and "no upcoming episodes" until the network answers — the app
  // stating the opposite of the truth. The two lists are gated separately so a
  // slow manga fetch can't hold back the anime sections.
  //
  // A *failed* fetch is the same hazard wearing a different hat, and it used to
  // slip through: a query in the error state has `isLoading === false` and no
  // data, so the sections rendered those same empty states as settled fact,
  // with nothing on screen distinguishing "offline" from "you have watched
  // nothing". It gets the error treatment the list page has.
  return (
    <div className="space-y-9 px-8 pb-12 pt-7">
      {/* Pinned above the rest: this is the "right now" card, and it is only
          useful while something is actually playing. */}
      <NowPlayingCard />

      {/* Below the now-playing card, which is pinned above the loading gate:
          what you are watching right now outranks what the season is popular
          for. Above everything else, because it is the only section that is
          not about your own list — and outside the gate for the same reason,
          since it does not need the list to render. */}
      <SeasonHero />

      {isLoading ? (
        <DashboardSkeleton />
      ) : error ? (
        <div>
          <p className="text-danger">
            {t("list.loadError", { message: String(error) })}
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : (
        <>
          <Stats entries={allAnime} />
          <Birthdays userId={userId} settled={!mangaLoading} />
          <WeeklyDigest entries={allAnime} />
          <AiringSoon entries={allAnime} />
          <ContinueStrip type="ANIME" entries={allAnime} save={save} />
          <RecommendedSection type="ANIME" entries={allAnime} />
        </>
      )}
      {!mangaLoading && (
        <>
          <ContinueStrip type="MANGA" entries={allManga} save={mangaSave} />
          <RecommendedSection
            type="MANGA"
            entries={allManga}
            listUnavailable={!!mangaError}
          />
        </>
      )}
    </div>
  );
}

/**
 * Stand-in for the sections above while the list loads: a stat row and two
 * poster grids, matching the real layout closely enough that nothing jumps
 * when the data lands. Unlabelled on purpose — no i18n keys needed.
 */
function DashboardSkeleton() {
  return (
    <div className="space-y-9" aria-hidden="true">
      {/* The stat cards keep their real frame and shimmer only the value, so
          the row is already the right height and nothing shifts when the
          numbers land. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="rounded-xl border border-hair bg-surface-900 px-4 py-3 panel-wash"
          >
            <Shimmer index={i} className="h-5 w-16" />
            <Shimmer index={i} className="mt-2 h-2 w-20" />
          </div>
        ))}
      </div>
      {Array.from({ length: 2 }, (_, section) => (
        <div key={section} className="space-y-4">
          <HeaderSkeleton index={section * 3} />
          <CoverGridSkeleton count={6} />
        </div>
      ))}
    </div>
  );
}

/** Shows in progress, most recently touched first, with a +1 shortcut. */
function ContinueStrip({
  type,
  entries,
  save,
}: {
  type: MediaType;
  entries: MediaListEntry[];
  save: ReturnType<typeof useListMutations>["save"];
}) {
  const { t } = useTranslation();
  // Read here, not in the memoized card — see `GridCard`'s `blurred`.
  const level = useContentFilter((s) => s.level);
  const blurAdult = useContentFilter((s) => s.blurAdult);
  const watching = useMemo(
    () =>
      entries
        .filter((e) => e.status === "CURRENT" || e.status === "REPEATING")
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [entries],
  );

  // `save` itself is a fresh object every render, but `save.mutate` is a stable
  // reference — depending on the object would hand every card a new callback
  // and defeat the memo on ContinueCard.
  const { mutate } = save;
  const plusOne = useCallback(
    (entry: MediaListEntry) =>
      mutate({ mediaId: entry.mediaId, progress: entry.progress + 1 }),
    [mutate],
  );

  // The anime strip keeps its empty state — it is the screen's anchor and
  // the nudge toward the season. A manga twin saying "you read nothing" to
  // every anime-only user is noise, so that one simply is not there.
  if (type === "MANGA" && watching.length === 0) return null;

  return (
    <section>
      <SectionHeader
        icon={type === "ANIME" ? Play : BookOpen}
        title={t(
          type === "ANIME"
            ? "dashboard.continueWatching"
            : "dashboard.continueReading",
        )}
      />
      {watching.length === 0 ? (
        <EmptyState
          visual={<PerchRule />}
          title={t("dashboard.nothingWatching")}
          hint={
            <Link to="/seasonal" className="text-accent-400 hover:underline">
              {t("dashboard.currentSeason")}
            </Link>
          }
        />
      ) : (
        <div className="media-grid mt-4 gap-x-4 gap-y-5">
          {watching.map((entry) => (
            <ContinueCard
              key={entry.id}
              type={type}
              entry={entry}
              onPlusOne={plusOne}
              blurred={shouldBlur(entry.media, level, blurAdult)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** The next episodes due on the list, soonest first. */
function AiringSoon({ entries }: { entries: MediaListEntry[] }) {
  const { t } = useTranslation();
  const upcoming = useMemo(
    () =>
      entries
        .filter(
          (e) =>
            e.media.nextAiringEpisode &&
            (e.status === "CURRENT" ||
              e.status === "REPEATING" ||
              e.status === "PLANNING"),
        )
        .sort(
          (a, b) =>
            a.media.nextAiringEpisode!.airingAt -
            b.media.nextAiringEpisode!.airingAt,
        ),
    [entries],
  );

  return (
    <section>
      <SectionHeader icon={CalendarClock} title={t("dashboard.upcoming")} />
      {upcoming.length === 0 ? (
        <EmptyState visual={<TickMarks />} title={t("dashboard.noUpcoming")} />
      ) : (
        <div className="mt-3 grid gap-0.5 2xl:grid-cols-2">
          {upcoming.slice(0, 10).map((entry) => (
            <AiringRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

const WEEK_SECS = 7 * 24 * 3600;

/**
 * "This week" digest: episodes of the shows you're watching that air within
 * the next seven days. Sourced entirely from the cached list (each entry
 * carries `nextAiringEpisode`) through `lib/calendar`'s `fromList`, which the
 * calendar page shares — one implementation of "what airs in this window".
 *
 * Manga is intentionally absent: AniList exposes no chapter-release schedule,
 * so there is no truthful "new chapters this week" to show.
 */
function WeeklyDigest({ entries }: { entries: MediaListEntry[] }) {
  const { t, i18n } = useTranslation();

  const thisWeek = useMemo(() => {
    const now = Date.now() / 1000;
    return fromList(entries, now, now + WEEK_SECS);
  }, [entries]);

  if (thisWeek.length === 0) return null;

  const shows = new Set(thisWeek.map((x) => x.mediaId)).size;

  return (
    <section>
      <SectionHeader
        icon={CalendarDays}
        title={t("dashboard.thisWeek")}
        meta={t("dashboard.thisWeekSummary", { count: thisWeek.length, shows })}
      />
      <div className="mt-3 grid gap-0.5 2xl:grid-cols-2">
        {thisWeek.map((item) => (
          <DigestRow
            key={item.entry.id}
            media={item.entry.media}
            note={t("common.episode", { n: item.episode })}
            when={new Date(item.airingAt * 1000).toLocaleString(i18n.language, {
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          />
        ))}
      </div>
      {/* The digest is the teaser; the calendar is the real thing — per-day
          grouping, other weeks, and everything airing rather than only yours. */}
      <Link
        to="/calendar"
        className="mt-2 inline-block px-2.5 text-xs text-accent-400 hover:underline"
      >
        {t("dashboard.fullCalendar")}
      </Link>
    </section>
  );
}

/**
 * Favourite characters and staff whose birthday is today. Absent entirely on
 * most days, which is what makes it worth glancing at on the others.
 *
 * One request per day, not per mount: the query key carries the date, so the
 * cached answer serves every remount until midnight mints a new key. And it
 * waits for the two list queries to settle (`settled`) so the dashboard's
 * mount burst stays at two concurrent requests — the birthday read is a
 * *third* moment, deliberately after, not alongside.
 */
function Birthdays({ userId, settled }: { userId: number; settled: boolean }) {
  const { t } = useTranslation();
  const mode = useAuth((s) => s.mode);
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const q = useQuery({
    queryKey: ["social", "birthdays", userId, `${month}-${day}`],
    queryFn: () => favouriteBirthdays(userId),
    enabled: isTauri && settled && mode === "anilist" && userId > 0,
    staleTime: Infinity,
  });

  const today = useMemo(
    () => (q.data ? birthdaysOn(q.data, month, day) : []),
    [q.data, month, day],
  );

  if (today.length === 0) return null;

  return (
    <section>
      <SectionHeader icon={Cake} title={t("dashboard.birthdays")} />
      <div className="mt-3 flex flex-wrap gap-2">
        {today.map((p) => (
          <Link
            key={`${p.kind}-${p.id}`}
            to={`/${p.kind}/${p.id}`}
            className="flex items-center gap-2.5 rounded-lg bg-surface-900 py-2 pl-2 pr-4 transition-surface hover:bg-surface-850"
          >
            <Avatar src={p.image?.medium} name={p.name.full ?? "?"} size="md" />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-ink-100">
                {p.name.full}
              </span>
              <span className="block text-2xs text-ink-600">
                {p.kind === "character"
                  ? t("dashboard.birthdayCharacter")
                  : t("dashboard.birthdayStaff")}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Stats({ entries }: { entries: MediaListEntry[] }) {
  const { t, i18n } = useTranslation();
  const scoreFormat = useScoreFormat();
  const stats = useMemo(() => {
    const unique = new Map(entries.map((e) => [e.mediaId, e]));
    const list = [...unique.values()];
    const episodes = list.reduce((sum, e) => sum + e.progress, 0);
    const minutes = list.reduce(
      (sum, e) => sum + e.progress * (e.media.duration ?? 24),
      0,
    );
    const scored = list.filter((e) => e.score > 0);
    const meanScore =
      scored.length > 0
        ? scored.reduce((sum, e) => sum + e.score, 0) / scored.length
        : null;
    return {
      anime: list.length,
      episodes,
      days: minutes / 60 / 24,
      meanScore,
    };
  }, [entries]);

  if (stats.anime === 0) return null;

  const items = [
    { label: t("dashboard.statAnime"), value: String(stats.anime) },
    {
      label: t("dashboard.statEpisodes"),
      value: stats.episodes.toLocaleString(i18n.language),
    },
    { label: t("dashboard.statDays"), value: stats.days.toFixed(1) },
    {
      label: t("dashboard.statMeanScore"),
      value:
        stats.meanScore !== null
          ? formatMeanScore(scoreFormat, stats.meanScore)
          : "–",
    },
  ];

  return (
    <section>
      <SectionHeader icon={BarChart3} title={t("dashboard.stats")} />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="panel-wash panel-top rounded-xl border border-surface-800 bg-surface-900 px-4 py-3.5"
          >
            <p className="text-2xl font-bold tabular-nums text-ink-100">
              {item.value}
            </p>
            <p className="mt-0.5 text-2xs font-medium uppercase tracking-[.13em] text-ink-600">
              {item.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Memoized: a +1 flips the mutation state on the parent twice (optimistic
 * patch, then settle), and without this every card in the section reconciles
 * both times. Safe to memo because — unlike `MediaCard` — it never writes
 * through its props, so a shallow compare sees every change that matters.
 * `onPlusOne` takes the entry so the parent can hand out one stable callback.
 */
const ContinueCard = memo(function ContinueCard({
  type,
  entry,
  onPlusOne,
  blurred,
}: {
  type: MediaType;
  entry: MediaListEntry;
  onPlusOne: (entry: MediaListEntry) => void;
  /** Computed by the parent — see `GridCard` for why it is not read here. */
  blurred: boolean;
}) {
  const { t } = useTranslation();
  const scoreFormat = useScoreFormat();
  const { media } = entry;
  // The list's own check — `maxProgress` knows chapters, `media.episodes`
  // does not, which is what kept this card anime-only for so long.
  const canPlus = canIncrement(entry);
  const total = maxProgress(media);

  return (
    <CoverCell
      to={`/media/${media.id}`}
      cover={media.coverImage.large}
      adult={media.isAdult === true}
      blurred={blurred}
      revealLabel={displayTitle(media.title)}
      score={entry.score > 0 ? formatScore(scoreFormat, entry.score) : null}
      progress={total ? { current: entry.progress, total } : null}
      actions={
        // Always visible, not hover-only: this is the most-used action in the
        // app, and hiding it behind a hover costs a deliberate movement every
        // single time.
        canPlus && (
          <IconButton
            variant="accent"
            size="sm"
            round
            onClick={() => onPlusOne(entry)}
            aria-label={t("common.plusOne")}
            title={t(
              type === "ANIME" ? "dashboard.markWatched" : "dashboard.markRead",
              { n: entry.progress + 1 },
            )}
            className="shadow-[0_.25rem_.75rem_rgba(0,0,0,.5)]"
          >
            <Plus className="size-4" />
          </IconButton>
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
        {t(
          type === "ANIME" ? "common.progressEpisodes" : "common.progressChapters",
          { n: entry.progress, total: total ?? "?" },
        )}
      </CoverMeta>
    </CoverCell>
  );
});

function AiringRow({ entry }: { entry: MediaListEntry }) {
  const { t } = useTranslation();
  const airing = entry.media.nextAiringEpisode!;

  const formatAiring = (airingAt: number): string => {
    const diff = airingAt * 1000 - Date.now();
    if (diff <= 0) return t("dashboard.airingNow");
    const hours = Math.floor(diff / 3_600_000);
    const days = Math.floor(hours / 24);
    if (days > 0)
      return t("dashboard.airingInDays", { d: days, h: hours % 24 });
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    return t("dashboard.airingInHours", { h: hours, m: minutes });
  };

  return (
    <DigestRow
      media={entry.media}
      note={
        t("common.episode", { n: airing.episode }) +
        (entry.progress < airing.episode - 1
          ? ` · ${t("dashboard.youAreAt", { n: entry.progress })}`
          : "")
      }
      when={formatAiring(airing.airingAt)}
    />
  );
}
