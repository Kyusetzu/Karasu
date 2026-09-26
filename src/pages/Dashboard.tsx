import { memo, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { BookOpen, Cake, CalendarClock, CalendarDays, Clock, Play, Plus, Star, Tv, type LucideIcon } from "lucide-react";
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
import SeasonHero from "@/components/media/SeasonHero";
import RecommendedSection from "@/components/media/RecommendedSection";
import { useColumnCount } from "@/hooks/useColumnCount";
import { cn } from "@/lib/utils";
import { useTheme } from "@/stores/theme";

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
  // Only recommendations need the manga list; the Rust-side cache the manga list page fills serves it.
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

  // One content-filtered base for every section below, so a new section cannot skip the check.
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

  const ready = !isLoading && !error;

  // Keep the loading and error gates, one per list; an unloaded or failed list renders its empty states as fact.
  return (
    <div className="space-y-9 px-8 pb-12 pt-7">
      {/* The figures sit under the banner, where the eye lands first; the hero needs no list, the figures do. */}
      <div className="space-y-4">
        <SeasonHero />
        {ready && <Stats entries={allAnime} />}
      </div>

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
          <ContinueStrip type="ANIME" entries={allAnime} save={save} />
          <div className="grid items-start gap-x-8 gap-y-9 lg:grid-cols-2">
            <WeeklyDigest entries={allAnime} />
            <AiringSoon entries={allAnime} />
          </div>
        </>
      )}
      {!mangaLoading && <ContinueStrip type="MANGA" entries={allManga} save={mangaSave} />}
      {ready && (
        <>
          <Birthdays userId={userId} settled={!mangaLoading} />
          <RecommendedSection type="ANIME" entries={allAnime} />
        </>
      )}
      {!mangaLoading && (
        <RecommendedSection
          type="MANGA"
          entries={allManga}
          listUnavailable={!!mangaError}
        />
      )}
    </div>
  );
}

/** Stand-in while the list loads, shaped like the real layout so nothing jumps; unlabelled on purpose. */
function DashboardSkeleton() {
  return (
    <div className="space-y-9" aria-hidden="true">
      {/* Real frame, shimmering value only, so the row is already the right height when the numbers land. */}
      <div className="grid grid-cols-2 overflow-hidden rounded-panel border border-hair bg-surface-900 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={cn("flex flex-col items-center gap-2 px-3 py-4", statCellRule(i))}>
            <Shimmer index={i} className="size-8 rounded-full" />
            <Shimmer index={i} className="h-5 w-14" />
            <Shimmer index={i} className="h-2 w-16" />
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

  // Depend on the stable `save.mutate`, not the fresh `save` object, or the memo on ContinueCard is defeated.
  const { mutate } = save;
  const plusOne = useCallback(
    (entry: MediaListEntry) =>
      mutate({ mediaId: entry.mediaId, progress: entry.progress + 1 }),
    [mutate],
  );

  // One row, measured off the grid itself; the store's setting stands in until the first measurement lands.
  const grid = useRef<HTMLDivElement>(null);
  const coverCols = useTheme((s) => s.coverCols);
  const measured = useColumnCount(grid, coverCols);
  const perRow = measured > 1 ? measured : coverCols;
  const more = watching.length > perRow;

  // Anime keeps its empty state as the screen's anchor; a manga one would be noise for anime-only users.
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
        meta={more ? String(watching.length) : undefined}
        action={
          more && (
            <Link to={type === "ANIME" ? "/list" : "/manga"} className="text-xs text-accent-400 hover:underline">
              {t("dashboard.showAll")}
            </Link>
          )
        }
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
        <div ref={grid} className="media-grid mt-4 gap-x-4 gap-y-5">
          {watching.slice(0, perRow).map((entry) => (
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
    <ListPanel icon={CalendarClock} title={t("dashboard.upcoming")}>
      {upcoming.length === 0 ? (
        <EmptyState visual={<TickMarks />} title={t("dashboard.noUpcoming")} />
      ) : (
        upcoming.slice(0, 10).map((entry) => <AiringRow key={entry.id} entry={entry} />)
      )}
    </ListPanel>
  );
}

const WEEK_SECS = 7 * 24 * 3600;

/** This week's episodes through `lib/calendar`'s `fromList`, shared with the calendar page; manga has no release schedule. */
function WeeklyDigest({ entries }: { entries: MediaListEntry[] }) {
  const { t, i18n } = useTranslation();

  const thisWeek = useMemo(() => {
    const now = Date.now() / 1000;
    return fromList(entries, now, now + WEEK_SECS);
  }, [entries]);

  if (thisWeek.length === 0) return null;

  return (
    <ListPanel
      icon={CalendarDays}
      title={t("dashboard.thisWeek")}
      meta={t("dashboard.episodeCount", { count: thisWeek.length })}
      footer={
        // The digest is the teaser; the calendar is the real thing, with other weeks and everything airing.
        <Link to="/calendar" className="text-xs text-accent-400 hover:underline">
          {t("dashboard.fullCalendar")}
        </Link>
      }
    >
      {thisWeek.map((item) => (
        <PanelRow
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
    </ListPanel>
  );
}

/** A dashboard list in a panel of its own: the heading inside the frame, one hairline between rows. */
function ListPanel({
  icon: Icon,
  title,
  meta,
  footer,
  children,
}: {
  icon: LucideIcon;
  title: string;
  meta?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-panel border border-hair bg-surface-900 panel-wash">
      <header className="flex items-center gap-2.5 border-b border-hair px-4 py-3">
        <Icon className="size-4 shrink-0 text-accent-400" />
        <h2 className="shrink-0 text-sm font-semibold text-ink-100">{title}</h2>
        {meta && <span className="ml-auto min-w-0 truncate text-2xs uppercase tracking-eyebrow text-ink-600">{meta}</span>}
      </header>
      <div className="[&>*+*]:border-t [&>*+*]:border-hair">{children}</div>
      {footer && <div className="border-t border-hair px-4 py-2.5">{footer}</div>}
    </section>
  );
}

/** One line of a panel: the cover, the title over its note, and when as a single-line chip. */
function PanelRow({
  media,
  note,
  when,
}: {
  media: Pick<MediaListEntry["media"], "id" | "title" | "coverImage">;
  note: string;
  when: string;
}) {
  return (
    <Link
      to={`/media/${media.id}`}
      className="flex items-center gap-3 px-4 py-2.5 transition-surface hover:bg-surface-850"
    >
      <img src={media.coverImage.large ?? ""} alt="" loading="lazy" className="h-11 w-8 shrink-0 rounded-inner object-cover" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui font-medium text-ink-100">{displayTitle(media.title)}</p>
        <p className="truncate text-xs text-ink-600">{note}</p>
      </div>
      <span className="shrink-0 whitespace-nowrap rounded-full border border-hair px-2 py-0.5 text-2xs tabular-nums text-ink-300">
        {when}
      </span>
    </Link>
  );
}

/** Favourites born today, keyed by date for one request a day; waits for `settled` so the mount burst stays at two. */
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
            className="flex items-center gap-2.5 rounded-control bg-surface-900 py-2 pl-2 pr-4 transition-surface hover:bg-surface-850"
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

  const items: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: Tv, label: t("dashboard.statAnime"), value: String(stats.anime) },
    {
      icon: Play,
      label: t("dashboard.statEpisodes"),
      value: stats.episodes.toLocaleString(i18n.language),
    },
    { icon: Clock, label: t("dashboard.statDays"), value: stats.days.toFixed(1) },
    {
      icon: Star,
      label: t("dashboard.statMeanScore"),
      value:
        stats.meanScore !== null
          ? formatMeanScore(scoreFormat, stats.meanScore)
          : "–",
    },
  ];

  return (
    <section
      aria-label={t("dashboard.stats")}
      className="grid grid-cols-2 overflow-hidden rounded-panel border border-hair bg-surface-900 panel-wash sm:grid-cols-4"
    >
      {items.map((item, i) => (
        <div key={item.label} className={cn("flex flex-col items-center gap-1.5 px-3 py-4 text-center", statCellRule(i))}>
          <span className="grid size-8 place-items-center rounded-full border tint-fill tint-accent text-accent-400">
            <item.icon aria-hidden className="size-4" />
          </span>
          <p className="text-2xl font-bold leading-none tabular-nums text-ink-100">{item.value}</p>
          <p className="text-2xs uppercase tracking-eyebrow text-ink-600">{item.label}</p>
        </div>
      ))}
    </section>
  );
}

/** The hairlines between the figures: a cross in two columns, three dividers in one row of four. */
function statCellRule(i: number): string {
  return cn(i % 2 === 1 && "border-l border-hair", i >= 2 && "border-t border-hair sm:border-t-0", i === 2 && "sm:border-l");
}

/** Memoized, safe because it never writes through its props; `onPlusOne` takes the entry so one callback serves all. */
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
  // The list's own check; `maxProgress` knows chapters where `media.episodes` does not.
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
        // Always visible, not hover-only: the most-used action in the app must not cost a hover every time.
        canPlus && (
          <IconButton
            variant="accentOnCover"
            size="sm"
            round
            onClick={() => onPlusOne(entry)}
            aria-label={t("common.plusOne")}
            title={t(
              type === "ANIME" ? "dashboard.markWatched" : "dashboard.markRead",
              { n: entry.progress + 1 },
            )}
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
    <PanelRow
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
