import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BarChart3, CalendarClock, CalendarDays, Play, Plus } from "lucide-react";
import { fetchMediaList } from "@/api/anilist";
import { displayTitle, type MediaListEntry } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked } from "@/lib/contentFilter";
import { useListMutations } from "@/hooks/useListMutations";
import { Button } from "@/components/ui/button";
import NowPlayingCard from "@/components/NowPlayingCard";

export default function Dashboard() {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const loading = useAuth((s) => s.loading);
  const enableLocal = useAuth((s) => s.enableLocal);

  if (loading) return null;

  if (!viewer && mode !== "local") {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-3xl font-bold">{t("dashboard.welcomeTitle")}</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            {t("dashboard.welcomeText")}
          </p>
          <Link to="/settings">
            <Button className="mt-5">{t("dashboard.connect")}</Button>
          </Link>
          {/* Switches to the account-free list in place — the store flips
              `mode`, which re-renders straight into the dashboard below. */}
          <button
            type="button"
            onClick={() => enableLocal()}
            className="mt-3 block w-full text-xs text-ink-500 underline-offset-2 hover:text-ink-300 hover:underline"
          >
            {t("dashboard.startLocal")}
          </button>
        </div>
      </div>
    );
  }

  return <DashboardContent userId={viewer?.id ?? 0} />;
}

function DashboardContent({ userId }: { userId: number }) {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["mediaList", "ANIME", userId],
    queryFn: () => fetchMediaList(userId, "ANIME"),
  });
  const { save } = useListMutations(userId, "ANIME");
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

  const watching = useMemo(
    () =>
      allAnime
        .filter((e) => e.status === "CURRENT" || e.status === "REPEATING")
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [allAnime],
  );

  const upcoming = useMemo(
    () =>
      allAnime
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
    [allAnime],
  );

  return (
    <div className="space-y-8 p-8">
      <NowPlayingCard />
      <WeeklyDigest entries={allAnime} />
      <section>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Play className="size-4.5 text-accent-400" />{" "}
          {t("dashboard.continueWatching")}
        </h2>
        {watching.length === 0 ? (
          <p className="mt-3 text-sm text-ink-600">
            {t("dashboard.nothingWatching")}{" "}
            <Link to="/seasonal" className="text-accent-400 hover:underline">
              {t("dashboard.currentSeason")}
            </Link>
            .
          </p>
        ) : (
          <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
            {watching.map((entry) => (
              <ContinueCard
                key={entry.id}
                entry={entry}
                onPlusOne={() =>
                  save.mutate({
                    mediaId: entry.mediaId,
                    progress: entry.progress + 1,
                  })
                }
              />
            ))}
          </div>
        )}
      </section>

      <Stats entries={allAnime} />

      <section>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <CalendarClock className="size-4.5 text-accent-400" />{" "}
          {t("dashboard.upcoming")}
        </h2>
        {upcoming.length === 0 ? (
          <p className="mt-3 text-sm text-ink-600">
            {t("dashboard.noUpcoming")}
          </p>
        ) : (
          <div className="mt-4 space-y-1">
            {upcoming.slice(0, 10).map((entry) => (
              <AiringRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const WEEK_SECS = 7 * 24 * 3600;

/**
 * "This week" digest: episodes of the shows you're watching that air within
 * the next seven days, grouped by local weekday. Sourced entirely from the
 * cached list (each entry carries `nextAiringEpisode`), so it works offline.
 *
 * Manga is intentionally absent: AniList exposes no chapter-release schedule,
 * so there is no truthful "new chapters this week" to show.
 */
function WeeklyDigest({ entries }: { entries: MediaListEntry[] }) {
  const { t, i18n } = useTranslation();

  const thisWeek = useMemo(() => {
    const now = Date.now() / 1000;
    const end = now + WEEK_SECS;
    return entries
      .filter(
        (e) =>
          (e.status === "CURRENT" || e.status === "REPEATING") &&
          e.media.nextAiringEpisode &&
          e.media.nextAiringEpisode.airingAt >= now &&
          e.media.nextAiringEpisode.airingAt <= end,
      )
      .sort(
        (a, b) =>
          a.media.nextAiringEpisode!.airingAt -
          b.media.nextAiringEpisode!.airingAt,
      );
  }, [entries]);

  if (thisWeek.length === 0) return null;

  const shows = new Set(thisWeek.map((e) => e.mediaId)).size;

  return (
    <section>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <CalendarDays className="size-4.5 text-accent-400" />{" "}
        {t("dashboard.thisWeek")}
      </h2>
      <p className="mt-1 text-sm text-ink-500">
        {t("dashboard.thisWeekSummary", { count: thisWeek.length, shows })}
      </p>
      <div className="mt-4 space-y-1">
        {thisWeek.map((entry) => (
          <Link
            key={entry.id}
            to={`/media/${entry.media.id}`}
            className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-900"
          >
            <img
              src={entry.media.coverImage.large ?? ""}
              alt=""
              loading="lazy"
              className="h-12 w-9 rounded object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink-100">
                {displayTitle(entry.media.title)}
              </p>
              <p className="text-xs text-ink-600">
                {t("common.episode", { n: entry.media.nextAiringEpisode!.episode })}
              </p>
            </div>
            <span className="shrink-0 text-sm tabular-nums text-accent-400">
              {new Date(
                entry.media.nextAiringEpisode!.airingAt * 1000,
              ).toLocaleString(i18n.language, {
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Stats({ entries }: { entries: MediaListEntry[] }) {
  const { t, i18n } = useTranslation();
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
      value: stats.meanScore !== null ? stats.meanScore.toFixed(1) : "–",
    },
  ];

  return (
    <section>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <BarChart3 className="size-4.5 text-accent-400" />{" "}
        {t("dashboard.stats")}
      </h2>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-surface-800 bg-surface-900 px-4 py-3"
          >
            <p className="text-xl font-bold tabular-nums">{item.value}</p>
            <p className="text-xs text-ink-600">{item.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ContinueCard({
  entry,
  onPlusOne,
}: {
  entry: MediaListEntry;
  onPlusOne: () => void;
}) {
  const { t } = useTranslation();
  const { media } = entry;
  const canPlus = media.episodes === null || entry.progress < media.episodes;
  const pct = media.episodes ? (entry.progress / media.episodes) * 100 : 0;

  return (
    <div className="group w-36 shrink-0">
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-800">
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
        {canPlus && (
          <button
            onClick={onPlusOne}
            className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-accent-600 text-accent-ink opacity-0 transition-opacity hover:bg-accent-500 group-hover:opacity-100"
            aria-label={t("common.plusOne")}
            title={t("dashboard.markWatched", { n: entry.progress + 1 })}
          >
            <Plus className="size-4" />
          </button>
        )}
        {media.episodes !== null && (
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
        {media.episodes ? ` / ${media.episodes}` : ""}
      </p>
    </div>
  );
}

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
    <Link
      to={`/media/${entry.media.id}`}
      className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-900"
    >
      <img
        src={entry.media.coverImage.large ?? ""}
        alt=""
        loading="lazy"
        className="h-12 w-9 rounded object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-100">
          {displayTitle(entry.media.title)}
        </p>
        <p className="text-xs text-ink-600">
          {t("common.episode", { n: airing.episode })}
          {entry.progress < airing.episode - 1 &&
            ` · ${t("dashboard.youAreAt", { n: entry.progress })}`}
        </p>
      </div>
      <span className="shrink-0 text-sm tabular-nums text-accent-400">
        {formatAiring(airing.airingAt)}
      </span>
    </Link>
  );
}
