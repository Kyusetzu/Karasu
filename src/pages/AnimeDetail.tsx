import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { isOffline } from "@/lib/apiError";
import { mediaUrl } from "@/lib/anilistUrl";
import { isAndroid, usePlatform } from "@/stores/platform";
import { OfflineDetail } from "@/components/media/OfflineDetail";
import {
  ChevronRight,
  ExternalLink,
  Share2,
  Play,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trophy,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { shareText } from "@choochmeque/tauri-plugin-sharekit-api";
import {
  animeDetail,
  mediaCast,
  mediaTrends,
  streamingEpisodes,
  type ExternalLink as ExternalLinkData,
  type MediaDetail,
  type MediaTag,
} from "@/api/queries";
import {
  myReview,
  rateReview,
  reviews,
  type ReviewPage,
  type ReviewRow,
} from "@/api/social";
import { AreaChart } from "@/components/stats/AreaChart";
import { Avatar, UserLockup } from "@/components/ui/user-lockup";
import { Markdown } from "@/components/social/Markdown";
import { ReviewComposerModal } from "@/components/overlays/ReviewComposerModal";
import CoverViewer from "@/components/overlays/CoverViewer";
import { Presence } from "@/components/ui/presence";
import { usePresence } from "@/hooks/usePresence";
import { relTimeFromSeconds } from "@/lib/relTime";
import { showToast } from "@/stores/toast";
import {
  formatLabel,
  fuzzyDate,
  mediaStatusLabel,
  sourceLabel,
} from "@/lib/format";
import { isTauri } from "@/api/anilist";
import { displayTitle } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useCachedEntry } from "@/hooks/useCachedEntry";
import { useLibrary } from "@/stores/library";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked, shouldBlur } from "@/lib/contentFilter";
import BackButton from "@/components/shell/BackButton";
import { DetailSkeleton, Shimmer } from "@/components/Skeleton";
import { cn } from "@/lib/utils";
import { DecodedImage } from "@/components/media/DecodedImage";
import { BannerImage } from "@/components/media/BannerImage";
import { BANNER_RATIO } from "@/lib/bannerFit";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { parseAniListHtml } from "@/lib/anilistHtml";
import { FavouriteButton } from "@/components/media/FavouriteButton";
import { GenreChips, MetaLine, NextEpisode, TimeLeft } from "@/components/media/DetailFacts";
import { StatusMenu } from "@/components/media/StatusMenu";
import { IconButton } from "@/components/ui/icon-button";
import { usePhoneShell } from "@/hooks/usePhoneShell";
import { RichText } from "@/components/RichText";
import { ScoreColumns, StatusBar } from "@/components/stats/panels";

/** The phone's square actions, the height of the status button beside them. */
const SQUARE = "size-11 rounded-panel border border-surface-700 bg-surface-900 text-ink-300 hover:border-surface-600 hover:text-ink-100";

export default function AnimeDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const mediaId = Number(id);
  // Subscribe to the data, not a store function: a function's identity never changes, so a scan would never re-render.
  const episodes = useLibrary((s) => s.episodes[mediaId]);
  const play = useLibrary((s) => s.play);
  const level = useContentFilter((s) => s.level);
  const blurAdult = useContentFilter((s) => s.blurAdult);
  const profileMode = useAuth((s) => s.mode);
  const viewer = useAuth((s) => s.viewer);
  const phone = usePhoneShell();
  const [revealed, setRevealed] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const coverViewer = usePresence(coverOpen);
  const android = isAndroid(usePlatform((s) => s.info));

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["mediaDetail", mediaId],
    queryFn: () => animeDetail(mediaId),
    enabled: isTauri && Number.isFinite(mediaId),
  });
  /** The local list's entry, since mediaListEntry is null in local mode; keeps ListEditor from seeding over a real entry. */
  const cachedEntry = useCachedEntry(0, data?.type, mediaId);

  // A skeleton at the hero's real proportions rather than a line of text, so the page does not move twice.
  if (isLoading) return <DetailSkeleton />;
  // Offline gets its own answer: DETAIL_QUERY has no cache, so OfflineDetail serves what the list cache already holds.
  if (error && isOffline(error))
    return <OfflineDetail mediaId={mediaId} onRetry={() => void refetch()} />;
  if (error)
    return (
      <p className="p-8 text-danger">
        {t("common.error", { message: String(error) })}
      </p>
    );
  if (!data) return null;

  // Reachable by a direct link even when filtered, so it gets an explicit reveal rather than a blank page.
  if (isBlocked(data, level) && !revealed) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-sm text-center">
          <p className="text-sm text-ink-300">{t("detail.filtered")}</p>
          {/* The sentence says the setting lives in Settings, so it links there. */}
          <Link
            to="/settings?pane=appearance"
            className="mt-1 block text-xs text-accent-400 hover:underline"
          >
            {t("detail.filteredHint")}
          </Link>
          <Button className="mt-4" onClick={() => setRevealed(true)}>
            {t("detail.filteredShow")}
          </Button>
        </div>
      </div>
    );
  }

  const title = displayTitle(data.title);

  // The list entry for the badge under the title; mediaListEntry rides DETAIL_QUERY, so it costs no request.
  const entry = data.mediaListEntry ?? cachedEntry;
  // Local mode only: the pill must not claim "not on your list" while useCachedEntry is still undefined (unread).
  const localPending = profileMode === "local" && cachedEntry === undefined;
  const total = data.type === "MANGA" ? data.chapters : data.episodes;
  const progressLabel =
    entry && entry.progress > 0
      ? total
        ? `· ${entry.progress} / ${total}`
        : `· ${entry.progress}`
      : null;

  const coverSrc = data.coverImage.extraLarge ?? data.coverImage.large ?? "";

  /** The banner and the cover share revealed with the filter gate, so one "Show anyway" press answers for both images. */
  const veiled = shouldBlur(data, level, blurAdult) && !revealed;

  const studioEdges = data.studios?.edges ?? [];
  const mainStudios = studioEdges.filter((e) => e.isMain).map((e) => e.node);
  const producers = studioEdges.filter((e) => !e.isMain).map((e) => e.node);
  // Files on disk past the entry's progress; Android has no library, so it never offers the button.
  const canPlay =
    data.type === "ANIME" && !!episodes?.some((e) => e > (data.mediaListEntry?.progress ?? 0));
  // The same rule as the editor below: nothing to change without an account or a local list.
  const canEdit = !!viewer || profileMode === "local";

  // AniList's relations connection takes no arguments, so an adult spin-off can only be dropped here, client-side.
  const relatedEdges = data.relations.edges.filter(
    (e) =>
      (e.node.type === "ANIME" || e.node.type === "MANGA") &&
      !isBlocked(e.node, level),
  );

  return (
    <div>
      {/* The query container sits here, not on the page, since containment would pin the page's fixed overlays to it. */}
      <div className="@container">
        {/* A standard banner plus a band for the back button above and the cover below, capped at the desktop height. */}
        <div className="relative" style={{ height: `min(16rem, calc(100cqw / ${BANNER_RATIO} + 5.5rem))` }}>
          {data.bannerImage ? (
            <BannerImage src={data.bannerImage} veiled={veiled} />
          ) : (
            coverSrc && (
              <DecodedImage
                src={coverSrc}
                className="h-full w-full scale-110 object-cover blur-2xl"
                loadedOpacity={0.4}
              />
            )
          )}
          {/* A short fade into the page, so the contained banner stays whole above it. */}
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface-950 to-transparent" />
          {/* Anchored to the banner, not the centred column, or it drifts inward with the gutter on a wide display. */}
          <BackButton className="absolute left-6 top-3 z-10" />
        </div>
      </div>

      <div className="relative mx-auto max-w-4xl px-8 pb-10 2xl:max-w-none">
        {/* Floated on the phone, so a title longer than the cover carries on beneath it; wider, it overlaps the banner. */}
        <div className={cn("-mt-11 md:-mt-14", phone ? "flow-root" : "flex gap-6")}>
          {/* The incoming half of the cover-to-hero morph; unconditional because this page shows exactly one cover. */}
          <div className={cn("relative h-57 w-38 shrink-0", phone && "float-left mb-2 mr-5")}>
            <img
              src={coverSrc}
              alt=""
              style={{ viewTransitionName: "karasu-hero" }}
              className={cn(
                "h-57 w-38 rounded-cover border border-surface-700 object-cover shadow-[0_1.25rem_2.5rem_rgba(0,0,0,.65)]",
                veiled && "blur-xl",
              )}
            />
            {veiled && (
              <button
                onClick={() => setRevealed(true)}
                aria-label={title}
                className="absolute inset-0 grid place-items-center rounded-cover bg-surface-950/45 text-2xs font-semibold text-ink-100 transition hover:bg-surface-950/30"
              >
                <span className="rounded-full bg-surface-900/90 px-2.5 py-1">
                  {t("settings.blurReveal")}
                </span>
              </button>
            )}
            {/* Only once revealed: a lightbox must not be a way around the blur. */}
            {!veiled && coverSrc && (
              <button
                type="button"
                onClick={() => setCoverOpen(true)}
                aria-label={t("detail.viewCover")}
                className="absolute inset-0 cursor-zoom-in rounded-cover focus-visible:outline-2 focus-visible:outline-accent-500"
              />
            )}
          </div>
          {coverViewer.mounted && (
            <CoverViewer
              src={coverSrc}
              alt={title}
              leaving={coverViewer.leaving}
              onClose={() => setCoverOpen(false)}
            />
          )}
          <div className={cn("pt-16", !phone && "min-w-0 flex-1")}>
            <h1 className="text-[1.625rem] font-bold leading-tight text-ink-100">
              {title}
            </h1>
            {/* Native first, romaji only as a fallback: the Japanese face is part of the app's identity. */}
            {data.title.native && data.title.native !== title ? (
              <p className="font-brand-jp text-[1.0625rem] text-ink-500">
                {data.title.native}
              </p>
            ) : (
              data.title.romaji &&
              data.title.romaji !== title && (
                <p className="text-sm text-ink-500">{data.title.romaji}</p>
              )
            )}
            {phone ? (
              // Below the cover whatever the title's length: a short title leaves air beside it, never a squeezed column.
              <div className="clear-left space-y-2.5 pt-2.5">
                <MetaLine data={data} studios={mainStudios.map((s) => s.name)} />
                <GenreChips genres={data.genres} />
                <NextEpisode data={data} bar />
                <TimeLeft data={data} />
                <div className="flex gap-2">
                  {canEdit &&
                    (localPending ? (
                      // Not "Add to list" before the local list has answered whether the title is on it.
                      <Shimmer className="h-11 flex-1 rounded-panel" />
                    ) : (
                      <StatusMenu
                        media={data}
                        entry={entry ?? null}
                        progressLabel={progressLabel}
                        variant="sheet"
                        className="min-w-0 flex-1"
                      />
                    ))}
                  <FavouriteButton
                    kind={data.type === "MANGA" ? "manga" : "anime"}
                    id={data.id}
                    isFavourite={data.isFavourite}
                    blocked={data.isFavouriteBlocked}
                    square
                  />
                  <IconButton
                    onClick={() => openUrl(mediaUrl(data.type, data.id))}
                    aria-label={t("detail.openOnAniList")}
                    title={t("detail.openOnAniList")}
                    className={SQUARE}
                  >
                    <ExternalLink className="size-4.5" />
                  </IconButton>
                  {android && (
                    <IconButton
                      onClick={() => void shareText(mediaUrl(data.type, data.id)).catch(() => {})}
                      aria-label={t("ctx.share")}
                      title={t("ctx.share")}
                      className={SQUARE}
                    >
                      <Share2 className="size-4.5" />
                    </IconButton>
                  )}
                </div>
                {canPlay && (
                  <Button className="h-11 w-full rounded-panel" onClick={() => play(data.id)} title={t("common.playNext")}>
                    <Play className="size-3.75" fill="currentColor" />
                    {t("common.playNext")}
                  </Button>
                )}
              </div>
            ) : (
              <>
                {canEdit ? (
                  // undefined from useCachedEntry means not loaded yet as well as not listed, so offer nothing until it resolves.
                  !localPending && (
                    <StatusMenu
                      media={data}
                      entry={entry ?? null}
                      progressLabel={progressLabel}
                      variant="dropdown"
                      className="mt-2.5"
                    />
                  )
                ) : (
                  // Without an account there is no list to change, so the title only says it is not on one.
                  <p className="mt-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-surface-700 px-2.5 py-0.5 text-2xs text-ink-500">
                      {t("detail.notOnList")}
                    </span>
                  </p>
                )}
                <MetaLine data={data} studios={mainStudios.map((s) => s.name)} className="mt-2.5" />
                <GenreChips genres={data.genres} className="mt-2" />
                <TimeLeft data={data} className="mt-2" />
                <NextEpisode data={data} className="mt-2" />
                {canPlay && (
                  <Button
                    className="mt-3"
                    onClick={() => play(data.id)}
                    title={t("common.playNext")}
                  >
                    <Play className="size-3.75" fill="currentColor" />
                    {t("common.playNext")}
                  </Button>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <FavouriteButton
                    kind={data.type === "MANGA" ? "manga" : "anime"}
                    id={data.id}
                    isFavourite={data.isFavourite}
                    blocked={data.isFavouriteBlocked}
                  />
                  <button
                    onClick={() => openUrl(mediaUrl(data.type, data.id))}
                    className="flex items-center gap-1 text-xs text-ink-500 hover:text-accent-400"
                  >
                    {t("detail.openOnAniList")} <ExternalLink className="size-2.75" />
                  </button>
                  {android && (
                    <button
                      onClick={() => void shareText(mediaUrl(data.type, data.id)).catch(() => {})}
                      className="flex items-center gap-1 text-xs text-ink-500 hover:text-accent-400"
                    >
                      {t("ctx.share")} <Share2 className="size-2.75" />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Prose left at a reading measure, metadata right taking the slack, since everything in it wraps and fills. */}
        <div className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,48rem)_minmax(0,1fr)] 2xl:items-start">
          <div className="min-w-0 space-y-6">
            {data.description && (
              <Card>
                <CardTitle>{t("detail.description")}</CardTitle>
                {/* Elements, not dangerouslySetInnerHTML: lib/anilistHtml parses to nodes so no __html string ever exists. */}
                <p className="mt-3 max-w-176 text-ui leading-[1.75] text-pretty text-ink-300">
                  <RichText nodes={parseAniListHtml(data.description)} />
                </p>
              </Card>
            )}

            <CommunitySection data={data} />

            {data.type === "ANIME" && data.status !== "NOT_YET_RELEASED" && (
              <EpisodesSection mediaId={data.id} />
            )}

            <TrendSection mediaId={data.id} />

            <ReviewsSection mediaId={data.id} />

            {data.trailer?.id && (
              <Card>
                <CardTitle>{t("detail.trailer")}</CardTitle>
                {/* No img: the thumbnail is on a third-party host img-src refuses, and widening it would leak the user's IP. */}
                <button
                  onClick={() => openUrl(trailerUrl(data.trailer!))}
                  aria-label={t("detail.trailerPlay")}
                  className="group mt-3 grid aspect-video w-full max-w-md place-items-center overflow-hidden rounded-control bg-surface-800 transition-surface hover:bg-surface-700"
                >
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-950/70 transition-surface group-hover:bg-surface-950">
                    <Play fill="currentColor" className="size-5 text-ink-100" />
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

          <div className="2xl:col-span-2">
            <CastSection mediaId={data.id} />
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
              {/* Wraps instead of scrolling sideways: across both columns there is room for the whole franchise. */}
              <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-4">
                {relatedEdges.map((e) => (
                  <Link
                    key={`${e.relationType}-${e.node.id}`}
                    to={`/media/${e.node.id}`}
                    className="group block"
                  >
                    {/* The same lift as the trailer thumbnail; these are equally clickable and should say so. */}
                    <img
                      src={e.node.coverImage.large ?? ""}
                      alt=""
                      loading="lazy"
                      className="aspect-[2/3] w-full rounded-control object-cover transition-transform group-hover:-translate-y-1"
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

/** The licensed episode list behind a fold; opening spends its own request rather than bloating DETAIL_QUERY. */
function EpisodesSection({ mediaId }: { mediaId: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const episodes = useQuery({
    queryKey: ["episodes", mediaId],
    queryFn: () => streamingEpisodes(mediaId),
    enabled: isTauri && open,
    staleTime: 6 * 60 * 60 * 1000,
  });

  return (
    <Card>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <CardTitle>{t("detail.episodes")}</CardTitle>
        <ChevronRight
          className={cn("size-4 shrink-0 text-ink-500 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-3">
          {episodes.isLoading && <Shimmer className="h-24 w-full rounded-control" />}
          {episodes.error != null && (
            <p className="text-sm text-danger">
              {t("common.error", { message: String(episodes.error) })}
            </p>
          )}
          {episodes.data && episodes.data.length === 0 && (
            <p className="text-xs text-ink-600">{t("detail.episodesNone")}</p>
          )}
          {episodes.data && episodes.data.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
              {episodes.data.map((ep, i) => (
                <button
                  key={i}
                  onClick={() => ep.url && openUrl(ep.url)}
                  disabled={!ep.url}
                  className="group block text-left"
                  title={ep.site ?? undefined}
                >
                  {/* Same policy as the trailer: these thumbnails live on CDNs the CSP does not allow, so no img. */}
                  <div className="grid aspect-video w-full place-items-center overflow-hidden rounded-control bg-surface-800 transition-surface group-hover:bg-surface-700">
                    <Play className="size-5 text-ink-600" />
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-ink-300">{ep.title}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** Literal switch so i18nKeys.test.ts sees every key; only character roles are a closed enum worth translating. */
function characterRole(role: string | null, t: (k: string) => string): string {
  switch (role) {
    case "MAIN":
      return t("detail.roleMain");
    case "SUPPORTING":
      return t("detail.roleSupporting");
    case "BACKGROUND":
      return t("detail.roleBackground");
    default:
      return "";
  }
}

/** Cast and staff behind a fold; one request pages both lists, and the button is countless since total is a sentinel. */
function CastSection({ mediaId }: { mediaId: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const cast = useInfiniteQuery({
    queryKey: ["cast", mediaId],
    queryFn: ({ pageParam }) => mediaCast(mediaId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, all) =>
      last.hasMoreCharacters || last.hasMoreStaff ? all.length + 1 : undefined,
    enabled: isTauri && open,
    staleTime: 6 * 60 * 60 * 1000,
  });

  const characters = (cast.data?.pages ?? []).flatMap((p) => p.characters);
  const staff = (cast.data?.pages ?? []).flatMap((p) => p.staff);

  return (
    <Card>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <CardTitle>{t("detail.cast")}</CardTitle>
        <ChevronRight
          className={cn("size-4 shrink-0 text-ink-500 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-3 space-y-5">
          {cast.isLoading && <Shimmer className="h-24 w-full rounded-control" />}
          {cast.error != null && (
            <p className="text-sm text-danger">
              {t("common.error", { message: String(cast.error) })}
            </p>
          )}
          {characters.length > 0 && (
            <div>
              <p className="text-2xs font-semibold uppercase tracking-eyebrow text-ink-600">
                {t("detail.castCharacters")}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {characters.map((c) => {
                  const va = c.voiceActors[0];
                  return (
                    <div
                      key={c.node.id}
                      className="flex items-center justify-between gap-3 rounded-control bg-surface-900 p-2"
                    >
                      <Link
                        to={`/character/${c.node.id}`}
                        className="flex min-w-0 items-center gap-2.5 transition-surface hover:text-accent-400"
                      >
                        <Avatar src={c.node.image.medium} name={c.node.name.full ?? "?"} />
                        <span className="min-w-0">
                          <span className="block truncate text-xs text-ink-100">
                            {c.node.name.full}
                          </span>
                          <span className="block text-2xs text-ink-600">
                            {characterRole(c.role, t)}
                          </span>
                        </span>
                      </Link>
                      {va && (
                        <Link
                          to={`/staff/${va.id}`}
                          className="flex min-w-0 shrink-0 items-center gap-2.5 transition-surface hover:text-accent-400"
                        >
                          <span className="block max-w-28 truncate text-right text-xs text-ink-300">
                            {va.name.full}
                          </span>
                          <Avatar src={va.image.medium} name={va.name.full ?? "?"} />
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {staff.length > 0 && (
            <div>
              <p className="text-2xs font-semibold uppercase tracking-eyebrow text-ink-600">
                {t("detail.castStaff")}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {staff.map((s, i) => (
                  <Link
                    key={`${s.node.id}-${i}`}
                    to={`/staff/${s.node.id}`}
                    className="flex min-w-0 items-center gap-2.5 rounded-control bg-surface-900 p-2 transition-surface hover:text-accent-400"
                  >
                    <Avatar src={s.node.image.medium} name={s.node.name.full ?? "?"} />
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-ink-100">
                        {s.node.name.full}
                      </span>
                      <span className="block truncate text-2xs text-ink-600">{s.role}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {cast.hasNextPage && (
            <Button
              variant="outline"
              size="control"
              onClick={() => cast.fetchNextPage()}
              disabled={cast.isFetchingNextPage}
            >
              {t("social.loadMorePlain")}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/** Reviews behind a fold: opening spends the request, and voting patches the page with the server's numbers. */
function ReviewsSection({ mediaId }: { mediaId: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [composer, setComposer] = useState<{
    existing: Awaited<ReturnType<typeof myReview>>;
  } | null>(null);
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const canWrite = mode === "anilist" && viewer !== null;

  const revs = useInfiniteQuery({
    queryKey: ["social", "reviews", mediaId],
    queryFn: ({ pageParam }) => reviews(mediaId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.pageInfo.hasNextPage ? all.length + 1 : undefined),
    enabled: isTauri && open,
    staleTime: 30 * 60 * 1000,
  });

  const vote = useMutation({
    mutationFn: (vars: { id: number; rating: "UP_VOTE" | "DOWN_VOTE" | "NO_VOTE" }) =>
      rateReview(vars.id, vars.rating),
    onSuccess: (res, vars) => {
      qc.setQueryData(
        ["social", "reviews", mediaId],
        (old: InfiniteData<ReviewPage> | undefined) =>
          old && {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              reviews: p.reviews.map((r) => (r.id === vars.id ? { ...r, ...res } : r)),
            })),
          },
      );
    },
    onError: (e) =>
      showToast({ kind: "error", text: t("common.error", { message: String(e) }) }),
  });

  // The lookup happens on the click, not the mount; a query racing the detail page's own skips the budget check.
  const compose = useMutation({
    mutationFn: () => myReview(mediaId, viewer!.id),
    onSuccess: (mine) => setComposer({ existing: mine }),
    onError: (e) =>
      showToast({ kind: "error", text: t("common.error", { message: String(e) }) }),
  });

  const rows = (revs.data?.pages ?? []).flatMap((p) => p.reviews);

  return (
    <Card>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <CardTitle>{t("detail.reviews")}</CardTitle>
        <ChevronRight
          className={cn("size-4 shrink-0 text-ink-500 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {revs.isLoading && <Shimmer className="h-24 w-full rounded-control" />}
          {revs.error != null && (
            <p className="text-sm text-danger">
              {t("common.error", { message: String(revs.error) })}
            </p>
          )}
          {revs.data && rows.length === 0 && (
            <p className="text-xs text-ink-600">{t("detail.reviewsNone")}</p>
          )}
          {rows.map((r) => (
            <ReviewCard
              key={r.id}
              review={r}
              canVote={canWrite}
              votePending={vote.isPending}
              onVote={(rating) => vote.mutate({ id: r.id, rating })}
            />
          ))}
          <div className="flex items-center gap-2">
            {revs.hasNextPage && (
              <Button
                variant="outline"
                size="control"
                onClick={() => revs.fetchNextPage()}
                disabled={revs.isFetchingNextPage}
              >
                {t("social.loadMorePlain")}
              </Button>
            )}
            {canWrite && (
              <Button
                variant="outline"
                size="control"
                onClick={() => compose.mutate()}
                disabled={compose.isPending}
              >
                {t("review.write")}
              </Button>
            )}
          </div>
        </div>
      )}
      {/* Presence, not PresenceIf: the boolean variant would hand the child a nulled existing for the length of the exit. */}
      <Presence value={composer}>
        {(c, leaving) => (
          <ReviewComposerModal
            mediaId={mediaId}
            existing={c.existing}
            onClose={() => setComposer(null)}
            leaving={leaving}
          />
        )}
      </Presence>
    </Card>
  );
}

/** One review: a summary that expands into the essay it already carries. */
function ReviewCard({
  review: r,
  canVote,
  votePending,
  onVote,
}: {
  review: ReviewRow;
  canVote: boolean;
  votePending: boolean;
  onVote: (rating: "UP_VOTE" | "DOWN_VOTE" | "NO_VOTE") => void;
}) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const up = r.userRating === "UP_VOTE";
  const down = r.userRating === "DOWN_VOTE";

  return (
    <div className="rounded-control bg-surface-900 p-3">
      <div className="flex items-center justify-between gap-3">
        <Link to={`/user/${encodeURIComponent(r.user?.name ?? "")}`} className="min-w-0">
          <UserLockup
            name={r.user?.name ?? "—"}
            src={r.user?.avatar?.medium}
            size="sm"
            nameClassName="text-xs font-medium text-ink-300"
            sub={
              <span className="block text-2xs text-ink-600">
                {relTimeFromSeconds(r.createdAt, i18n.language, t("notif.now"))}
              </span>
            }
          />
        </Link>
        {r.score != null && (
          <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-ink-300">
            <Star className="size-3 text-gold" fill="currentColor" />
            {t("detail.reviewScore", { n: r.score })}
          </span>
        )}
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-2 block w-full text-left text-sm text-ink-100 transition-surface hover:text-accent-400"
      >
        {r.summary}
      </button>

      {expanded && (
        <div className="mt-2 border-t border-hair pt-2">
          {/* siteUrl backs the parser's truncation notice, so "read the rest" has somewhere to go. */}
          <Markdown source={r.body} siteUrl={r.siteUrl ?? undefined} />
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <span className="mr-1 text-2xs text-ink-600">
          {t("review.helpful", { up: r.rating ?? 0, total: r.ratingAmount ?? 0 })}
        </span>
        {canVote && (
          <>
            <button
              onClick={() => onVote(up ? "NO_VOTE" : "UP_VOTE")}
              disabled={votePending}
              aria-pressed={up}
              title={t("review.voteUp")}
              className={cn(
                "rounded-inner p-1 transition-surface hover:bg-surface-800",
                up ? "text-success" : "text-ink-600",
              )}
            >
              <ThumbsUp className="size-3.5" fill={up ? "currentColor" : "none"} />
            </button>
            <button
              onClick={() => onVote(down ? "NO_VOTE" : "DOWN_VOTE")}
              disabled={votePending}
              aria-pressed={down}
              title={t("review.voteDown")}
              className={cn(
                "rounded-inner p-1 transition-surface hover:bg-surface-800",
                down ? "text-danger" : "text-ink-600",
              )}
            >
              <ThumbsDown className="size-3.5" fill={down ? "currentColor" : "none"} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The trending curve behind a fold, drawn with the statistics page's AreaChart; the click spends the request. */
function TrendSection({ mediaId }: { mediaId: number }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const trends = useQuery({
    queryKey: ["mediaTrends", mediaId],
    queryFn: () => mediaTrends(mediaId),
    enabled: isTauri && open,
    staleTime: 60 * 60 * 1000,
  });

  const points = (trends.data ?? []).map((p) => ({
    label: new Date(p.date * 1000).toLocaleDateString(i18n.language, {
      month: "short",
      day: "numeric",
    }),
    value: p.trending,
  }));

  return (
    <Card>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <CardTitle>{t("detail.trend")}</CardTitle>
        <ChevronRight
          className={cn("size-4 shrink-0 text-ink-500 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <div className="mt-3">
          {trends.isLoading && <Shimmer className="h-24 w-full rounded-control" />}
          {trends.error != null && (
            <p className="text-sm text-danger">
              {t("common.error", { message: String(trends.error) })}
            </p>
          )}
          {trends.data &&
            (points.length < 2 ? (
              <p className="text-xs text-ink-600">{t("detail.trendNone")}</p>
            ) : (
              <>
                <p className="mb-2 text-2xs text-ink-600">{t("detail.trendHint")}</p>
                <AreaChart data={points} />
              </>
            ))}
        </div>
      )}
    </Card>
  );
}

/** The community's numbers, all from the detail query, drawn with the statistics page's own components. */
function CommunitySection({ data }: { data: MediaDetail }) {
  const { t } = useTranslation();
  const scores = data.stats?.scoreDistribution ?? [];
  const statuses = [...(data.stats?.statusDistribution ?? [])].sort(
    (a, b) => b.amount - a.amount,
  );
  // All-time shelves first, then the best seasonal or yearly one per type; a full list repeats itself.
  const rankings = [...(data.rankings ?? [])]
    .sort((a, b) => Number(b.allTime ?? false) - Number(a.allTime ?? false) || a.rank - b.rank)
    .filter(
      (r, i, all) => r.allTime || all.findIndex((x) => x.type === r.type && !x.allTime) === i,
    )
    .slice(0, 4);

  if (!scores.length && !statuses.length && !rankings.length) return null;

  const rankLabel = (r: MediaDetail["rankings"][number]) => {
    const what = t(r.type === "RATED" ? "detail.rankRated" : "detail.rankPopular", {
      n: r.rank,
    });
    if (r.allTime) return `${what} · ${t("detail.rankAllTime")}`;
    const when = [
      r.season ? t(`season.${r.season}`, { defaultValue: r.season }) : null,
      r.year,
    ]
      .filter(Boolean)
      .join(" ");
    return when ? `${what} · ${when}` : what;
  };

  return (
    <div className="space-y-4">
      {rankings.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {rankings.map((r, i) => (
            <span
              key={i}
              className="flex items-center gap-1.5 rounded-inner border border-gold/40 bg-gold/10 px-2 py-1 text-xs text-gold"
            >
              <Trophy className="size-3" />
              {rankLabel(r)}
            </span>
          ))}
        </div>
      )}
      {(scores.length > 0 || statuses.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {scores.length > 0 && (
            <ScoreColumns
              title={t("detail.communityScores")}
              hint={t("detail.communityScoresHint")}
              data={scores.map((d) => ({ score: d.score, count: d.amount }))}
              max={100}
            />
          )}
          {statuses.length > 0 && (
            <StatusBar
              title={t("detail.communityStatus")}
              data={statuses.map((d) => ({
                label: t(`status.${data.type ?? "ANIME"}.${d.status}`, {
                  defaultValue: d.status,
                }),
                count: d.amount,
              }))}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** AniList only ever reports youtube/dailymotion here. */
function trailerUrl(trailer: { id: string; site: string }): string {
  return trailer.site === "dailymotion"
    ? `https://www.dailymotion.com/video/${trailer.id}`
    : `https://www.youtube.com/watch?v=${trailer.id}`;
}

/** A comma-joined list of studios, each linking to its own page. */
function StudioLinks({ studios }: { studios: { id: number; name: string }[] }) {
  if (!studios.length) return null;
  return (
    <>
      {studios.map((s, i) => (
        <span key={s.id}>
          {i > 0 && ", "}
          <Link to={`/studio/${s.id}`} className="hover:text-accent-400 hover:underline">
            {s.name}
          </Link>
        </span>
      ))}
    </>
  );
}

/** One label/value row; renders nothing when there is no value. */
function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div>
      <dt className="text-xs text-ink-600">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-300">{value}</dd>
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
        <Row label={t("detail.studios")} value={<StudioLinks studios={mainStudios} />} />
        <Row label={t("detail.producers")} value={<StudioLinks studios={producers} />} />
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
                    className="rounded-inner bg-surface-800 px-2 py-0.5 text-xs"
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

/** Media tags with their community rank; spoiler tags stay collapsed behind an explicit reveal. */
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
            className="flex items-center gap-1.5 rounded-control border border-surface-700 bg-surface-850 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:border-surface-600 hover:text-ink-100"
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

