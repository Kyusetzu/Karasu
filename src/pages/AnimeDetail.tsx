import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Clock, ExternalLink, Play, Star } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  animeDetail,
  type ExternalLink as ExternalLinkData,
  type MediaDetail,
  type MediaTag,
} from "@/api/queries";
import {
  countdown,
  formatLabel,
  fuzzyDate,
  mediaStatusLabel,
  sourceLabel,
} from "@/lib/format";
import { formatMinutes, remainingMinutes } from "@/lib/estimate";
import { isTauri, saveListEntry } from "@/api/anilist";
import {
  displayTitle,
  maxProgress,
  STATUS_ORDER,
  type MediaListStatus,
  type MediaType,
} from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useLibrary } from "@/stores/library";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked } from "@/lib/contentFilter";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import TagEditor from "@/components/TagEditor";
import { parseNotes, serializeNotes } from "@/lib/tags";

/** AniList descriptions: strip spoilers, allow only harmless tags. */
function sanitizeDescription(html: string): string {
  return html
    .replace(/~!([\s\S]*?)!~/g, "")
    .replace(/<(?!\/?(b|i|em|strong|br)\b)[^>]*>/gi, "");
}

export default function AnimeDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const mediaId = Number(id);
  const hasNext = useLibrary((s) => s.hasNext);
  const play = useLibrary((s) => s.play);
  const level = useContentFilter((s) => s.level);
  const [revealed, setRevealed] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["mediaDetail", mediaId],
    queryFn: () => animeDetail(mediaId),
    enabled: isTauri && Number.isFinite(mediaId),
  });

  if (isLoading) return <p className="p-8 text-ink-500">{t("common.loading")}</p>;
  if (error)
    return (
      <p className="p-8 text-red-300">
        {t("common.error", { message: String(error) })}
      </p>
    );
  if (!data) return null;

  // Reachable by a direct link even when everything else is filtered, so it
  // gets an explicit reveal rather than a blank page.
  if (isBlocked(data, level) && !revealed) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-sm text-center">
          <p className="text-sm text-ink-300">{t("detail.filtered")}</p>
          <p className="mt-1 text-xs text-ink-600">{t("detail.filteredHint")}</p>
          <Button className="mt-4" onClick={() => setRevealed(true)}>
            {t("detail.filteredShow")}
          </Button>
        </div>
      </div>
    );
  }

  const title = displayTitle(data.title);

  const coverSrc = data.coverImage.extraLarge ?? data.coverImage.large ?? "";

  const studioEdges = data.studios?.edges ?? [];
  const mainStudios = studioEdges.filter((e) => e.isMain).map((e) => e.node);
  const producers = studioEdges.filter((e) => !e.isMain).map((e) => e.node);
  const untilNext = data.nextAiringEpisode
    ? data.nextAiringEpisode.airingAt - Math.floor(Date.now() / 1000)
    : 0;

  // AniList's relations connection takes no arguments, so an adult spin-off of
  // an all-ages title can only be dropped here, client-side.
  const relatedEdges = data.relations.edges.filter(
    (e) =>
      (e.node.type === "ANIME" || e.node.type === "MANGA") &&
      !isBlocked(e.node, level),
  );

  return (
    <div>
      {/* Fixed-height banner slot regardless of whether AniList has a real
          bannerImage (common for manga) — the cover below overlaps into its
          bottom edge by a fixed amount, so a shorter slot here would push it
          off the top of the page. */}
      <div className="relative h-64">
        {data.bannerImage ? (
          <img
            src={data.bannerImage}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          coverSrc && (
            <img
              src={coverSrc}
              alt=""
              className="h-full w-full scale-110 object-cover opacity-40 blur-2xl"
            />
          )
        )}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface-950 to-transparent" />
        {/* Anchored to the banner, not to the centred column below — otherwise
            it drifts inward with the gutter and strands itself mid-artwork on
            a wide display. */}
        <BackButton className="absolute left-6 top-4 z-10" />
      </div>

      <div className="relative mx-auto max-w-4xl px-8 pb-10 2xl:max-w-none">
        <div className="-mt-16 flex gap-6">
          <img
            src={coverSrc}
            alt=""
            className="h-56 w-40 shrink-0 rounded-xl border border-surface-700 object-cover shadow-xl"
          />
          <div className="min-w-0 flex-1 pt-16">
            <h1 className="text-2xl font-bold">{title}</h1>
            {data.title.romaji && data.title.romaji !== title && (
              <p className="text-sm text-ink-500">{data.title.romaji}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-300">
              {data.averageScore !== null && (
                <span className="flex items-center gap-1 text-amber-300">
                  <Star className="size-3.5" fill="currentColor" /> {data.averageScore}%
                </span>
              )}
              {data.format && <span>{formatLabel(data.format, t)}</span>}
              {data.status && (
                <span>{mediaStatusLabel(data.status, t)}</span>
              )}
              {data.episodes && (
                <span>
                  {data.episodes} {t("common.episodes")}
                </span>
              )}
              {data.chapters && (
                <span>
                  {data.chapters} {t("common.chapters")}
                </span>
              )}
              {data.volumes && (
                <span>
                  {data.volumes} {t("common.volumes")}
                </span>
              )}
              {data.duration && (
                <span>{t("detail.minutes", { n: data.duration })}</span>
              )}
              {data.seasonYear && (
                <span>
                  {data.season ? `${t(`season.${data.season}`)} ` : ""}
                  {data.seasonYear}
                </span>
              )}
              {mainStudios.length > 0 && (
                <span className="text-ink-500">
                  {mainStudios.map((s) => s.name).join(", ")}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.genres.map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-surface-800 px-2.5 py-0.5 text-xs text-ink-300"
                >
                  {g}
                </span>
              ))}
            </div>
            {data.type === "ANIME" &&
              (() => {
                const remaining = remainingMinutes(
                  data,
                  data.mediaListEntry?.progress ?? 0,
                );
                return remaining !== null && remaining > 0 ? (
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-300">
                    <Clock className="size-3.5 text-ink-500" />
                    {t("detail.timeLeft", {
                      time: formatMinutes(remaining, t),
                    })}
                  </p>
                ) : null;
              })()}
            {data.nextAiringEpisode && (
              <p className="mt-2 text-sm text-accent-400">
                {t("detail.nextEpisode", {
                  n: data.nextAiringEpisode.episode,
                  date: new Date(
                    data.nextAiringEpisode.airingAt * 1000,
                  ).toLocaleString(i18n.language, {
                    weekday: "short",
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
                {untilNext && (
                  <span className="ml-2 text-ink-500">
                    ({countdown(untilNext, t)})
                  </span>
                )}
              </p>
            )}
            {data.type === "ANIME" &&
              hasNext(data.id, data.mediaListEntry?.progress ?? 0) && (
                <Button
                  className="mt-3"
                  onClick={() => play(data.id)}
                  title={t("common.playNext")}
                >
                  <Play className="size-3.75" fill="currentColor" />
                  {t("common.playNext")}
                </Button>
              )}
            <button
              onClick={() =>
                openUrl(
                  `https://anilist.co/${data.type === "MANGA" ? "manga" : "anime"}/${data.id}`,
                )
              }
              className="mt-2 flex items-center gap-1 text-xs text-ink-500 hover:text-accent-400"
            >
              {t("detail.openOnAniList")} <ExternalLink className="size-2.75" />
            </button>
          </div>
        </div>

        {/* Prose left, metadata right. The prose column is the *narrow* one
            and capped at a reading measure — stretching a synopsis across
            1400px would be worse than the gutters this replaces. The metadata
            column takes the slack instead, because everything in it (the
            information grid, tags, links) wraps and genuinely fills. */}
        <div className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,48rem)_minmax(0,1fr)] 2xl:items-start">
          <div className="min-w-0 space-y-6">
            <ListEditor
              media={data}
              mediaType={data.type}
              max={maxProgress(data)}
              entry={data.mediaListEntry}
            />

            {data.description && (
              <Card>
                <CardTitle>{t("detail.description")}</CardTitle>
                <p
                  className="mt-3 text-sm leading-relaxed text-ink-300"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeDescription(data.description),
                  }}
                />
              </Card>
            )}

            {data.trailer?.thumbnail && (
              <Card>
                <CardTitle>{t("detail.trailer")}</CardTitle>
                <button
                  onClick={() => openUrl(trailerUrl(data.trailer!))}
                  className="group relative mt-3 block w-full max-w-md overflow-hidden rounded-lg"
                >
                  <img
                    src={data.trailer.thumbnail}
                    alt=""
                    className="w-full transition-transform group-hover:scale-105"
                  />
                  <span className="absolute inset-0 grid place-items-center bg-black/30 transition-colors group-hover:bg-black/15">
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-black/70">
                      <Play fill="currentColor" className="size-5 text-white" />
                    </span>
                  </span>
                </button>
              </Card>
            )}

          </div>

          <div className="min-w-0 space-y-6">
            <InformationCard
              data={data}
              mainStudios={mainStudios}
              producers={producers}
            />
            <AlternativeTitles data={data} />
            <TagList tags={data.tags ?? []} />
            <LinkList links={data.externalLinks ?? []} />
          </div>

          {relatedEdges.length > 0 && (
            <div className="2xl:col-span-2">
              <div className="flex items-center justify-between">
                <CardTitle>{t("detail.related")}</CardTitle>
                <Link
                  to={`/franchise/${data.id}`}
                  className="text-xs text-accent-400 hover:underline"
                >
                  {t("franchise.view")}
                </Link>
              </div>
              {/* Wraps instead of scrolling sideways: across both columns
                  there is room to show the whole franchise at once. */}
              <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-4">
                {relatedEdges.map((e) => (
                  <Link
                    key={`${e.relationType}-${e.node.id}`}
                    to={`/media/${e.node.id}`}
                  >
                    <img
                      src={e.node.coverImage.large ?? ""}
                      alt=""
                      loading="lazy"
                      className="aspect-[2/3] w-full rounded-lg object-cover"
                    />
                    <p className="mt-1 text-xs text-accent-400">
                      {t(`relation.${e.relationType}`, {
                        defaultValue: e.relationType,
                      })}
                    </p>
                    <p className="line-clamp-2 text-xs text-ink-300">
                      {displayTitle(e.node.title)}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** AniList only ever reports youtube/dailymotion here. */
function trailerUrl(trailer: { id: string; site: string }): string {
  return trailer.site === "dailymotion"
    ? `https://www.dailymotion.com/video/${trailer.id}`
    : `https://www.youtube.com/watch?v=${trailer.id}`;
}

/** One label/value row; renders nothing when there is no value. */
function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <dt className="text-xs text-ink-600">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-200">{value}</dd>
    </div>
  );
}

function InformationCard({
  data,
  mainStudios,
  producers,
}: {
  data: MediaDetail;
  mainStudios: { id: number; name: string }[];
  producers: { id: number; name: string }[];
}) {
  const { t, i18n } = useTranslation();
  const num = (n: number | null) =>
    n === null || n === undefined ? "" : n.toLocaleString(i18n.language);

  return (
    <Card>
      <CardTitle>{t("detail.information")}</CardTitle>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 3xl:grid-cols-4">
        <Row
          label={t("common.status")}
          value={mediaStatusLabel(data.status, t)}
        />
        <Row label={t("detail.format")} value={formatLabel(data.format, t)} />
        <Row
          label={t("common.episodes")}
          value={data.episodes ? num(data.episodes) : ""}
        />
        <Row
          label={t("detail.episodeDuration")}
          value={data.duration ? t("detail.minutes", { n: data.duration }) : ""}
        />
        <Row
          label={t("detail.startDate")}
          value={fuzzyDate(data.startDate, i18n.language)}
        />
        <Row
          label={t("detail.endDate")}
          value={fuzzyDate(data.endDate, i18n.language)}
        />
        <Row
          label={t("detail.season")}
          value={
            data.seasonYear
              ? `${data.season ? `${t(`season.${data.season}`)} ` : ""}${data.seasonYear}`
              : ""
          }
        />
        <Row
          label={t("detail.meanScore")}
          value={data.meanScore ? `${data.meanScore}%` : ""}
        />
        <Row label={t("detail.popularity")} value={num(data.popularity)} />
        <Row label={t("detail.favorites")} value={num(data.favourites)} />
        <Row label={t("detail.source")} value={sourceLabel(data.source, t)} />
        <Row label={t("detail.country")} value={data.countryOfOrigin} />
        <Row
          label={t("detail.studios")}
          value={mainStudios.map((s) => s.name).join(", ")}
        />
        <Row
          label={t("detail.producers")}
          value={producers.map((s) => s.name).join(", ")}
        />
        <Row label={t("detail.hashtag")} value={data.hashtag} />
      </dl>
    </Card>
  );
}

function AlternativeTitles({ data }: { data: MediaDetail }) {
  const { t } = useTranslation();
  const synonyms = data.synonyms ?? [];
  if (!data.title.native && !data.title.romaji && synonyms.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardTitle>{t("detail.titles")}</CardTitle>
      <dl className="mt-3 space-y-3">
        <Row label={t("detail.romaji")} value={data.title.romaji} />
        <Row label={t("detail.english")} value={data.title.english} />
        <Row label={t("detail.native")} value={data.title.native} />
        {synonyms.length > 0 && (
          <Row
            label={t("detail.synonyms")}
            value={
              <span className="flex flex-wrap gap-1.5">
                {synonyms.map((s) => (
                  <span
                    key={s}
                    className="rounded-md bg-surface-800 px-2 py-0.5 text-xs"
                  >
                    {s}
                  </span>
                ))}
              </span>
            }
          />
        )}
      </dl>
    </Card>
  );
}

/**
 * Media tags with their community rank. Spoiler tags stay collapsed behind an
 * explicit reveal — the whole point of the flag.
 */
function TagList({ tags }: { tags: MediaTag[] }) {
  const { t } = useTranslation();
  const [showSpoilers, setShowSpoilers] = useState(false);
  if (tags.length === 0) return null;

  const safe = tags.filter((tg) => !tg.isMediaSpoiler);
  const spoilers = tags.filter((tg) => tg.isMediaSpoiler);
  const shown = showSpoilers ? [...safe, ...spoilers] : safe;

  return (
    <Card>
      <CardTitle>{t("detail.tags")}</CardTitle>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {shown.map((tg) => (
          <span
            key={tg.name}
            className="flex items-center gap-1.5 rounded-full bg-surface-800 px-2.5 py-0.5 text-xs text-ink-300"
          >
            {tg.name}
            {tg.rank !== null && (
              <span className="text-ink-600">{tg.rank}%</span>
            )}
          </span>
        ))}
      </div>
      {spoilers.length > 0 && !showSpoilers && (
        <button
          onClick={() => setShowSpoilers(true)}
          className="mt-3 text-xs text-ink-500 hover:text-accent-400"
        >
          {t("detail.showSpoilerTags", { n: spoilers.length })}
        </button>
      )}
    </Card>
  );
}

function LinkList({ links }: { links: ExternalLinkData[] }) {
  const { t } = useTranslation();
  if (links.length === 0) return null;
  return (
    <Card>
      <CardTitle>{t("detail.links")}</CardTitle>
      <div className="mt-3 flex flex-wrap gap-2">
        {links.map((l) => (
          <button
            key={l.id}
            onClick={() => openUrl(l.url)}
            className="flex items-center gap-1.5 rounded-lg border border-surface-700 bg-surface-850 px-3 py-1.5 text-xs text-ink-200 transition-colors hover:border-surface-600 hover:text-ink-100"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: l.color ?? "#64748b" }}
            />
            {l.site}
            <ExternalLink className="size-2.5 text-ink-600" />
          </button>
        ))}
      </div>
    </Card>
  );
}

function ListEditor({
  media,
  mediaType,
  max: maxTotal,
  entry,
}: {
  media: MediaDetail;
  mediaType: MediaType;
  max: number | null;
  entry: {
    id: number;
    status: MediaListStatus;
    progress: number;
    score: number;
    repeat: number;
    notes: string | null;
  } | null;
}) {
  const { t } = useTranslation();
  const mediaId = media.id;
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const qc = useQueryClient();
  const [status, setStatus] = useState<MediaListStatus>(
    entry?.status ?? "PLANNING",
  );
  const [progress, setProgress] = useState(entry?.progress ?? 0);
  const [score, setScore] = useState(entry?.score ?? 0);
  const [repeat, setRepeat] = useState(entry?.repeat ?? 0);
  const parsed = parseNotes(entry?.notes);
  const [notes, setNotes] = useState(parsed.notes);
  const [tags, setTags] = useState(parsed.tags);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setStatus(entry?.status ?? "PLANNING");
    setProgress(entry?.progress ?? 0);
    setScore(entry?.score ?? 0);
    setRepeat(entry?.repeat ?? 0);
    const p = parseNotes(entry?.notes);
    setNotes(p.notes);
    setTags(p.tags);
  }, [entry]);

  const save = useMutation({
    mutationFn: () =>
      saveListEntry(
        {
          mediaId,
          status,
          progress,
          score,
          repeat,
          notes: serializeNotes(notes, tags),
        },
        media,
      ),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ["mediaList"] });
      qc.invalidateQueries({ queryKey: ["mediaDetail", mediaId] });
    },
  });

  if (!viewer && mode !== "local") return null;
  const max = maxTotal ?? 99999;

  return (
    <Card>
      <CardTitle>
        {entry ? t("detail.myEntry") : t("detail.addToList")}
      </CardTitle>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-ink-500">{t("common.status")}</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as MediaListStatus)}
            className="h-9 rounded-lg border border-surface-700 bg-surface-900 px-2 text-sm focus:border-accent-500 focus:outline-none"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {t(`status.${mediaType}.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-500">
            {t("common.progress")}
          </span>
          <Input
            type="number"
            min={0}
            max={max}
            value={progress}
            onChange={(e) =>
              setProgress(Math.max(0, Math.min(max, Number(e.target.value))))
            }
            className="w-24"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-500">{t("common.score")}</span>
          <Input
            type="number"
            min={0}
            max={10}
            value={score}
            onChange={(e) =>
              setScore(Math.max(0, Math.min(10, Number(e.target.value))))
            }
            className="w-20"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-500">
            {mediaType === "MANGA" ? t("entry.rereads") : t("entry.rewatches")}
          </span>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              value={repeat}
              onChange={(e) => setRepeat(Math.max(0, Number(e.target.value)))}
              className="w-20"
            />
            <Button
              variant="secondary"
              size="icon"
              aria-label={t("entry.addRepeat")}
              title={t("entry.addRepeat")}
              onClick={() => setRepeat((r) => r + 1)}
            >
              +1
            </Button>
          </div>
        </label>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {saved
            ? t("common.saved")
            : entry
              ? t("common.save")
              : t("common.add")}
        </Button>
        {save.error && (
          <p className="text-sm text-red-300">{String(save.error)}</p>
        )}
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-sm text-ink-500">
          {t("tags.label")}
        </span>
        <TagEditor tags={tags} onChange={setTags} />
      </div>
      <label className="mt-3 block text-sm">
        <span className="mb-1 block text-ink-500">{t("entry.notes")}</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder={t("entry.notesPlaceholder")}
          className="w-full resize-y rounded-lg border border-surface-700 bg-surface-900 px-2 py-1.5 text-sm focus:border-accent-500 focus:outline-none"
        />
      </label>
    </Card>
  );
}
