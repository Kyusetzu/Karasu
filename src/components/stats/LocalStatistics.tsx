import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BarChart3 } from "lucide-react";
import { fetchMediaList, isTauri } from "@/api/anilist";
import { STATUS_ORDER, type MediaListStatus, type MediaType } from "@/api/types";
import { isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { useScoreFormat } from "@/stores/auth";
import { scoreScale } from "@/lib/scoreFormat";
import {
  activityHeatmap,
  localTotals,
  scoreDelta,
  seasonalHistory,
} from "@/lib/localStats";
import { Card, CardTitle } from "@/components/ui/card";
import { Tabs, type TabOption } from "@/components/ui/tabs";
import { Sunburst, ToneLegend, type Slice } from "@/components/stats/Charts";
import { ScoreColumns, StatusBar, TileGrid } from "@/components/stats/panels";
import { GradientBars } from "@/components/stats/GradientBars";
import { DotPlot } from "@/components/stats/DotPlot";
import { AreaChart } from "@/components/stats/AreaChart";
import { Heatmap } from "@/components/stats/Heatmap";
import { Empty } from "@/components/stats/shared";
import { fmt } from "@/components/stats/RankedList";

/**
 * Statistics for the account-free profile.
 *
 * The signed-in screen is built on AniList's `userStatistics`, so without an
 * account it showed a sign-in wall — to someone who had already answered that
 * question. But most of what that endpoint returns is *counting*, and the
 * entries are sitting in SQLite: `lib/localStats` computes the delta against
 * community scores, the activity heatmap, the seasonal habits and the totals
 * here at zero request cost, because there is no request to make.
 *
 * What is genuinely missing is stated rather than hidden. Minutes watched needs
 * a duration no list entry carries, and the genre, tag, studio, voice-actor and
 * staff rankings are AniList aggregating across every media a user has ever
 * touched — neither is a thing this screen could quietly approximate.
 */
export default function LocalStatistics({
  type,
  onType,
}: {
  type: MediaType;
  onType: (t: MediaType) => void;
}) {
  const { t, i18n } = useTranslation();
  const level = useContentFilter((s) => s.level);
  const scoreFormat = useScoreFormat();
  const scoreMax = scoreScale(scoreFormat).max;

  // `userId: 0` because local mode ignores it — `fetchMediaList` dispatches on
  // the profile mode and the Rust side reads the local table. The key still
  // carries it so this shares the cache with the list screens, which use the
  // same `viewer?.id ?? 0`.
  const { data, isLoading, error } = useQuery({
    queryKey: ["mediaList", type, 0],
    queryFn: () => fetchMediaList(0, type),
    enabled: isTauri,
  });

  // One filtered pool for every panel, so none of them can forget the check.
  const entries = useMemo(
    () =>
      (data?.lists ?? [])
        .filter((g) => !g.isCustomList)
        .flatMap((g) => g.entries)
        .filter((e) => !isBlocked(e.media, level)),
    [data, level],
  );

  const totals = useMemo(() => localTotals(entries), [entries]);
  const delta = useMemo(
    () => scoreDelta(entries, 5, scoreMax),
    [entries, scoreMax],
  );
  const heatmap = useMemo(() => activityHeatmap(entries), [entries]);
  const seasons = useMemo(() => seasonalHistory(entries), [entries]);

  const breakdown = useMemo<Slice[]>(() => {
    const byStatus = new Map<MediaListStatus, Map<string, number>>();
    for (const e of entries) {
      const formats = byStatus.get(e.status) ?? new Map<string, number>();
      const key = e.media.format ?? "?";
      formats.set(key, (formats.get(key) ?? 0) + 1);
      byStatus.set(e.status, formats);
    }
    return STATUS_ORDER.filter((st) => byStatus.has(st)).map((st) => {
      const formats = [...byStatus.get(st)!].sort((a, b) => b[1] - a[1]);
      return {
        label: t(`status.${type}.${st}`),
        value: formats.reduce((sum, [, n]) => sum + n, 0),
        children: formats.map(([label, value]) => ({ label, value })),
      };
    });
  }, [entries, t, type]);

  const monthLabels = useMemo(
    () =>
      Array.from({ length: 12 }, (_, m) =>
        new Date(2000, m, 1).toLocaleDateString(i18n.language, { month: "narrow" }),
      ),
    [i18n.language],
  );

  const typeOptions: TabOption<MediaType>[] = [
    { value: "ANIME", label: t("nav.list") },
    { value: "MANGA", label: t("nav.manga") },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8 2xl:max-w-none 3xl:max-w-[130rem]">
      <header className="flex items-center gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-800 text-ink-500">
          <BarChart3 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-xl font-bold">{t("stats.title")}</h1>
            <span className="font-brand-jp text-[.8125rem] tracking-[.04em] text-ink-600">
              統計
            </span>
          </div>
          <p className="text-xs text-ink-600">{t("stats.localSubtitle")}</p>
        </div>
      </header>

      <Tabs options={typeOptions} value={type} onChange={onType} />

      {isLoading && <p className="text-ink-500">{t("common.loading")}</p>}
      {error && (
        <p className="text-danger">{t("common.error", { message: String(error) })}</p>
      )}

      {!isLoading && !error && (totals.count === 0 ? <Empty /> : (
        <div className="space-y-6">
          <TileGrid
            tiles={[
              { label: t("stats.entries"), value: fmt(totals.count, i18n.language) },
              {
                label: t(type === "ANIME" ? "stats.episodes" : "stats.chapters"),
                value: fmt(totals.progressTotal, i18n.language),
              },
              {
                label: t("stats.meanScore"),
                value: totals.meanScore > 0 ? totals.meanScore.toFixed(2) : "—",
              },
              {
                label: t("stats.scoredTitles"),
                value: fmt(totals.scored, i18n.language),
              },
            ]}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <StatusBar
              title={t("stats.statuses")}
              data={STATUS_ORDER.filter((st) =>
                totals.byStatus.some((s) => s.status === st),
              ).map((st) => ({
                label: t(`status.${type}.${st}`),
                count: totals.byStatus.find((s) => s.status === st)!.count,
              }))}
            />
            {breakdown.length > 0 && (
              <Card className="flex h-full flex-col">
                <CardTitle>{t("stats.breakdown")}</CardTitle>
                <p className="mt-1 text-2xs text-ink-600">{t("stats.breakdownHint")}</p>
                {/* Chart beside its key, the same arrangement the signed-in
                    panel uses: the ring is square, so a full-width one would
                    make the card as tall as the page is wide. */}
                <div className="mt-3 flex flex-1 items-center gap-6">
                  <div className="w-40 shrink-0 sm:w-48">
                    <Sunburst data={breakdown} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <ToneLegend
                      items={breakdown.map((b) => ({ label: b.label, value: b.value }))}
                    />
                  </div>
                </div>
              </Card>
            )}
            {totals.scoreCounts.length > 0 && (
              <ScoreColumns
                title={t("stats.scoreDist")}
                hint={t("stats.scoreDistHint")}
                data={totals.scoreCounts}
                max={scoreMax}
              />
            )}
            {totals.releaseYears.length > 1 && (
              <Card className="flex h-full flex-col">
                <CardTitle>{t("stats.releaseYears")}</CardTitle>
                <p className="mt-1 text-2xs text-ink-600">{t("stats.releaseYearsHint")}</p>
                <div className="mt-4 flex flex-1 items-center">
                  <AreaChart
                    data={totals.releaseYears.slice(-20).map((y) => ({
                      label: String(y.year),
                      value: y.count,
                    }))}
                  />
                </div>
              </Card>
            )}
            {seasons.length > 0 && (
              <GradientBars
                title={t("stats.seasonHabits")}
                hint={t("stats.seasonHabitsHint")}
                rows={seasons.map((s) => ({
                  label: t(`season.${s.season}`, { defaultValue: s.season }),
                  value: s.count,
                  text: fmt(s.count, i18n.language),
                  sub: s.meanScore > 0 ? `★ ${s.meanScore.toFixed(1)}` : undefined,
                }))}
              />
            )}
            {delta && (delta.harshest.length > 0 || delta.kindest.length > 0) && (
              <DotPlot
                title={t("stats.vsCommunity")}
                hint={t("stats.vsCommunityHint")}
                legendMine={t("stats.legendMine")}
                legendOther={t("stats.legendCommunity")}
                rows={[...delta.harshest, ...delta.kindest].map((r) => ({
                  label: r.title,
                  mine: r.mine,
                  other: r.community,
                }))}
                max={scoreMax}
              />
            )}
            {heatmap && (
              <div className="lg:col-span-2">
                <Heatmap
                  title={t("stats.activityHeatmap")}
                  hint={t("stats.activityHeatmapHint")}
                  years={heatmap.years}
                  max={heatmap.max}
                  monthLabels={monthLabels}
                />
              </div>
            )}
          </div>

          {/* Said out loud rather than left as an absence. Someone comparing
              this against the website should know which figures need an
              account and why, not wonder whether Karasu forgot them. */}
          <p className="text-xs leading-relaxed text-ink-600">
            {t("stats.localMissing")}
          </p>
        </div>
      ))}
    </div>
  );
}
