import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Clock,
  ExternalLink,
  Play,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trophy,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
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
import { Presence } from "@/components/ui/presence";
import { relTimeFromSeconds } from "@/lib/relTime";
import { showToast } from "@/stores/toast";
import {
  countdown,
  formatLabel,
  fuzzyDate,
  mediaStatusLabel,
  sourceLabel,
} from "@/lib/format";
import { statusColorVar } from "@/lib/statusColors";
import { readableInk, UI_INK } from "@/lib/contrast";
import { useTheme } from "@/stores/theme";
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
import { useCachedEntry } from "@/hooks/useCachedEntry";
import { useLibrary } from "@/stores/library";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked, shouldBlur } from "@/lib/contentFilter";
import BackButton from "@/components/shell/BackButton";
import { DetailSkeleton, Shimmer } from "@/components/Skeleton";
import { cn } from "@/lib/utils";
import { DecodedImage } from "@/components/media/DecodedImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { ScoreBars } from "@/components/ui/score-bars";
import TagEditor from "@/components/media/TagEditor";
import { parseNotes, serializeNotes } from "@/lib/tags";
import { parseAniListHtml } from "@/lib/anilistHtml";
import { FavouriteButton } from "@/components/media/FavouriteButton";
import { RichText } from "@/components/RichText";
import { ScoreColumns, StatusBar } from "@/components/stats/panels";


export default function AnimeDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const mediaId = Number(id);
  // Subscribe to the *data*, not to `hasNext` — the same fix `ListRow` already
  // carries with the same comment. A selector returning the store's function
  // has an identity that never changes, so this page never re-rendered after a
  // library scan and the play button stayed missing until something else
  // happened to re-render it.
  const episodes = useLibrary((s) => s.episodes[mediaId]);
  const play = useLibrary((s) => s.play);
  const level = useContentFilter((s) => s.level);
  const blurAdult = useContentFilter((s) => s.blurAdult);
  const profileMode = useAuth((s) => s.mode);
  // The raw hexes, not the `var()`: `readableInk` needs a colour it can
  // measure, and a CSS variable is opaque to it.
  const statusColors = useTheme((st) => st.statusColors);
  const [revealed, setRevealed] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["mediaDetail", mediaId],
    queryFn: () => animeDetail(mediaId),
    enabled: isTauri && Number.isFinite(mediaId),
  });
  /**
   * The local list's entry, for the account-free profile.
   *
   * `mediaListEntry` rides `DETAIL_QUERY`, but in local mode `anilist_query`
   * sends no token and AniList has never heard of the local list — so it is
   * null for every title, including ones being actively tracked. Reading the
   * cached local list is what makes the pill true and, far more importantly,
   * what stops `ListEditor` seeding PLANNING/0/0 over a real entry.
   *
   * Above the early returns because it is a hook. `useCachedEntry` no-ops in
   * AniList mode, where `mediaListEntry` is authoritative.
   */
  /**
   * The local list's entry, for the account-free profile.
   *
   * `mediaListEntry` rides `DETAIL_QUERY`, but in local mode `anilist_query`
   * sends no token and AniList has never heard of the local list — so it comes
   * back null for every title, including ones being actively tracked. Reading
   * the cached local list is what makes the pill below true and, far more
   * importantly, what stops `ListEditor` seeding PLANNING/0/0 over a real entry
   * the moment Save is pressed.
   *
   * `useCachedEntry` no-ops in AniList mode, where `mediaListEntry` is
   * authoritative. The local list is keyed on user 0, the `?? 0` convention
   * every list screen uses.
   */
  const cachedEntry = useCachedEntry(0, data?.type, mediaId);

  // A skeleton at the hero's real proportions rather than a line of text:
  // the text sat at the top-left and then the whole page arrived underneath
  // it, which moves everything twice. Same reasoning as MediaList's.
  if (isLoading) return <DetailSkeleton />;
  if (error)
    return (
      <p className="p-8 text-danger">
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

  // The list entry, for the badge under the title. `mediaListEntry` rides on
  // `DETAIL_QUERY`, so this costs nothing beyond what the page already fetched.
  const entry = data.mediaListEntry ?? cachedEntry;
  // Local mode only: the pill must not claim "not on your list" before the
  // local list has been read. See `useCachedEntry`'s null-vs-undefined note.
  const localPending = profileMode === "local" && cachedEntry === undefined;
  const total = data.type === "MANGA" ? data.chapters : data.episodes;
  const progressLabel =
    entry && entry.progress > 0
      ? total
        ? `· ${entry.progress} / ${total}`
        : `· ${entry.progress}`
      : null;

  const coverSrc = data.coverImage.extraLarge ?? data.coverImage.large ?? "";

  /**
   * The banner and the cover, veiled together and revealed together.
   *
   * Sharing `revealed` with the filter gate above is the point: someone who
   * has already pressed "Show anyway" to reach a blocked title has answered
   * this question, and asking it again on the same screen would be the app not
   * listening. One flag, one press, both images.
   *
   * The no-banner fallback is left alone — it is the cover at `blur-2xl` and
   * 40% opacity already, which is a wash of colour rather than an image.
   */
  const veiled = shouldBlur(data, level, blurAdult) && !revealed;

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
          <DecodedImage
            src={data.bannerImage}
            className={cn(
              "h-full w-full object-cover",
              veiled && "scale-110 blur-2xl",
            )}
          />
        ) : (
          coverSrc && (
            <DecodedImage
              src={coverSrc}
              className="h-full w-full scale-110 object-cover blur-2xl"
              loadedOpacity={0.4}
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
        <div className="-mt-14 flex gap-6">
          {/* The incoming half of the cover-to-hero morph. Unconditional here
              because this page shows exactly one cover, so the name is unique
              by construction — the grid side has to be applied per click. */}
          <div className="relative h-57 w-38 shrink-0">
            <img
              src={coverSrc}
              alt=""
              style={{ viewTransitionName: "karasu-hero" }}
              className={cn(
                "h-57 w-38 rounded-[.625rem] border border-surface-700 object-cover shadow-[0_1.25rem_2.5rem_rgba(0,0,0,.65)]",
                veiled && "blur-xl",
              )}
            />
            {veiled && (
              <button
                onClick={() => setRevealed(true)}
                aria-label={title}
                className="absolute inset-0 grid place-items-center rounded-[.625rem] bg-surface-950/45 text-2xs font-semibold text-ink-200 transition hover:bg-surface-950/30"
              >
                <span className="rounded-full bg-surface-900/90 px-2.5 py-1">
                  {t("settings.blurReveal")}
                </span>
              </button>
            )}
          </div>
          <div className="min-w-0 flex-1 pt-16">
            <h1 className="text-[1.625rem] font-bold leading-tight text-ink-100">
              {title}
            </h1>
            {/* Native first, romaji only as a fallback — the Japanese face is
                part of the app's identity and this is the one screen with the
                room to set it properly. */}
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
            {/* Whether this is on your list, said where the title is rather
                than only inside the editor panel far below — which is where it
                was, and is why the answer was not visible without scrolling.
                Coloured from the same palette as the cover rings, so the badge
                here and the border on the card you arrived from agree. */}
            <p className="mt-2.5">
              {entry ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-2xs font-semibold"
                  style={{
                    backgroundColor: statusColorVar(entry.status),
                    // The palette is user-chosen, so the ink cannot be assumed:
                    // `readableInk` picks whichever of the app's two ink ends
                    // actually has contrast against the hue they picked.
                    color: readableInk(
                      statusColors[entry.status] ?? "#000000",
                      UI_INK,
                    ),
                  }}
                >
                  {t(`status.${data.type}.${entry.status}`)}
                  {progressLabel && <span className="opacity-80">{progressLabel}</span>}
                </span>
              ) : (
                // `undefined` from `useCachedEntry` means "not loaded yet" and
                // "not on the list" alike, so in local mode the honest thing
                // before it resolves is to say nothing rather than the second.
                localPending ? null : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-surface-700 px-2.5 py-0.5 text-2xs text-ink-500">
                    {t("detail.notOnList")}
                  </span>
                )
              )}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[.8125rem] text-ink-300">
              {data.averageScore !== null && (
                <span className="flex items-center gap-1 text-gold">
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
                  className="rounded-[.625rem] border border-surface-800 bg-surface-850 px-2 py-0.5 text-2xs text-ink-300"
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
                {/* `> 0`, not truthiness. `countdown` returns "" once the time
                    has passed, so a negative value — which is every moment
                    between an episode airing and AniList moving to the next —
                    rendered an empty pair of brackets; and at exactly zero,
                    `0 && …` renders the literal 0. */}
                {untilNext > 0 && (
                  <span className="ml-2 text-ink-500">
                    ({countdown(untilNext, t)})
                  </span>
                )}
              </p>
            )}
            {data.type === "ANIME" &&
              episodes?.some((e) => e > (data.mediaListEntry?.progress ?? 0)) && (
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
                onClick={() =>
                  openUrl(
                    `https://anilist.co/${data.type === "MANGA" ? "manga" : "anime"}/${data.id}`,
                  )
                }
                className="flex items-center gap-1 text-xs text-ink-500 hover:text-accent-400"
              >
                {t("detail.openOnAniList")} <ExternalLink className="size-2.75" />
              </button>
            </div>
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
              entry={entry ?? null}
            />

            {data.description && (
              <Card>
                <CardTitle>{t("detail.description")}</CardTitle>
                {/* Capped at a reading measure and set loose. A synopsis is
                    the only long-form prose in the app; `pretty` keeps it off
                    orphaned last words.

                    Elements, not `dangerouslySetInnerHTML`. This was the last
                    innerHTML in the app, and the sanitizer it needed had already
                    been a live XSS once — see `lib/anilistHtml`. */}
                <p className="mt-3 max-w-176 text-[.8125rem] leading-[1.75] text-pretty text-ink-300">
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
                {/* No `<img>`. The thumbnail is on a YouTube/Dailymotion host,
                    and `img-src` allows `self`, `data:` and `*.anilist.co` only
                    — so this rendered a broken-image box on every detail page
                    that has a trailer. Widening the policy is refused on
                    principle: it hands a third party the user's IP and what
                    they are looking at, for a thumbnail. CLAUDE.md measured the
                    same question for bio images and settled it there.

                    The card keeps its shape and its click; the art is what
                    goes. `aria-label` because its only content was the alt-less
                    image and two decorative spans, so it had no name at all. */}
                <button
                  onClick={() => openUrl(trailerUrl(data.trailer!))}
                  aria-label={t("detail.trailerPlay")}
                  className="group mt-3 grid aspect-video w-full max-w-md place-items-center overflow-hidden rounded-lg bg-surface-800 transition-surface hover:bg-surface-700"
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
              {/* Wraps instead of scrolling sideways: across both columns
                  there is room to show the whole franchise at once. */}
              <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-4">
                {relatedEdges.map((e) => (
                  <Link
                    key={`${e.relationType}-${e.node.id}`}
                    to={`/media/${e.node.id}`}
                    className="group block"
                  >
                    {/* The same lift the trailer thumbnail has had all
                        along — these are equally clickable and said so
                        with nothing at all. */}
                    <img
                      src={e.node.coverImage.large ?? ""}
                      alt=""
                      loading="lazy"
                      className="aspect-[2/3] w-full rounded-lg object-cover transition-transform duration-(--duration-expressive) ease-(--ease-out-expo) group-hover:-translate-y-1"
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

/**
 * The licensed episode list — titles and thumbnails — behind a fold.
 *
 * Deliberately its own on-demand query rather than a `DETAIL_QUERY` field:
 * measured at +49 KB for a long-runner, a 6× payload for a section most
 * visits never open. Opening the fold is the user-initiated moment that
 * spends the request; the six-hour staleTime makes reopening free. An empty
 * answer renders as a quiet line — only AniList-licensed titles carry these.
 */
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
          {episodes.isLoading && <Shimmer className="h-24 w-full rounded-lg" />}
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
                  {/* Same policy as the trailer above: these thumbnails live on
                      streaming CDNs the CSP does not allow, so they were broken
                      boxes. The tile stays as the click target. */}
                  <div className="grid aspect-video w-full place-items-center overflow-hidden rounded-lg bg-surface-800 transition-surface group-hover:bg-surface-700">
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

/** Literal switch, so `i18nKeys.test.ts` sees every key. Staff roles are
    free text from the API and render as data; only character roles are a
    closed enum worth translating. */
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

/**
 * Cast and staff behind a fold, finally linking the character/staff pages
 * from the one place people expect to reach them. One request per "load
 * more" click pages both lists together; the button is countless because
 * `pageInfo.total` is the capped sentinel on these collections.
 */
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
          {cast.isLoading && <Shimmer className="h-24 w-full rounded-lg" />}
          {cast.error != null && (
            <p className="text-sm text-danger">
              {t("common.error", { message: String(cast.error) })}
            </p>
          )}
          {characters.length > 0 && (
            <div>
              <p className="text-2xs font-semibold uppercase tracking-[.1em] text-ink-600">
                {t("detail.castCharacters")}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {characters.map((c) => {
                  const va = c.voiceActors[0];
                  return (
                    <div
                      key={c.node.id}
                      className="flex items-center justify-between gap-3 rounded-lg bg-surface-900 p-2"
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
              <p className="text-2xs font-semibold uppercase tracking-[.1em] text-ink-600">
                {t("detail.castStaff")}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {staff.map((s, i) => (
                  <Link
                    key={`${s.node.id}-${i}`}
                    to={`/staff/${s.node.id}`}
                    className="flex min-w-0 items-center gap-2.5 rounded-lg bg-surface-900 p-2 transition-surface hover:text-accent-400"
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

/**
 * Reviews behind a fold — essays, so five per page and a reading measure.
 *
 * Same on-demand contract as the other folds: opening spends the request,
 * "load more" is a countless button. Rows collapse to their summary; the
 * click that expands one is free, since the body already arrived. Voting
 * patches the page in place with what `RateReview` returns — the server's
 * numbers, not a guess — and the composer prefilms from `myReview`, its own
 * user-initiated lookup, because a review of yours that nobody voted on can
 * sit pages deep in a RATING_DESC feed.
 */
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

  // The lookup happens on the click, not the mount — a fourth query racing
  // the detail page's own would clear no pre-flight budget check.
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
          {revs.isLoading && <Shimmer className="h-24 w-full rounded-lg" />}
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
      {/* `Presence`, not `PresenceIf`: the composer state is a value, and the
          boolean variant would hand the child a nulled `existing` for the
          length of the exit — an edit session's title flipping to "write". */}
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
    <div className="rounded-lg bg-surface-900 p-3">
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
        <div className="mt-2 border-t border-surface-800 pt-2">
          {/* `siteUrl` backs the parser's truncation notice: a review body is
              an essay, and past the 8,000-char limit the "read the rest" line
              needs somewhere to go. */}
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
                "rounded p-1 transition-surface hover:bg-surface-800",
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
                "rounded p-1 transition-surface hover:bg-surface-800",
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

/**
 * The trending curve behind a fold — how loudly the site is talking about
 * this title, drawn with the statistics page's own AreaChart. Same on-demand
 * contract as the episode fold: the click spends the request.
 */
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
          {trends.isLoading && <Shimmer className="h-24 w-full rounded-lg" />}
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

/**
 * The community's numbers: ranking shelves, the score distribution, and what
 * status everyone else has the title under. All of it arrives on the detail
 * query — no extra request — and the two charts are the statistics page's own
 * components, so the same data draws the same way everywhere.
 */
function CommunitySection({ data }: { data: MediaDetail }) {
  const { t } = useTranslation();
  const scores = data.stats?.scoreDistribution ?? [];
  const statuses = [...(data.stats?.statusDistribution ?? [])].sort(
    (a, b) => b.amount - a.amount,
  );
  // The shelves worth a badge: all-time first, then the best seasonal/yearly
  // one per type — a full list repeats itself ("#12 of 2019, #43 of 2018…").
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
              className="flex items-center gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-2 py-1 text-xs text-gold"
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

/** One label/value row; renders nothing when there is no value. */
/**
 * A comma-joined list of studios, each linking to its own page.
 *
 * `Row` takes a `ReactNode`, so this needed no change there. Studios were a dead
 * end until the studio page existed — the names were already right, they just
 * went nowhere.
 */
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
            className="flex items-center gap-1.5 rounded-lg border border-surface-700 bg-surface-850 px-3 py-1.5 text-xs text-ink-300 transition-colors hover:border-surface-600 hover:text-ink-100"
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
      // Scoped to this title's own collection; the other cannot have changed.
      qc.invalidateQueries({ queryKey: ["mediaList", media.type] });
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
      {/* Same six pills as the modal — this is the panel people actually
          live in, so the two must not disagree about how status is set. */}
      <div className="mt-3 text-sm">
        <span className="mb-1.5 block text-ink-500">{t("common.status")}</span>
        <div className="flex flex-wrap gap-0.75">
          {STATUS_ORDER.map((s) => (
            <Pill key={s} active={status === s} onClick={() => setStatus(s)}>
              {t(`status.${mediaType}.${s}`)}
            </Pill>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
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
        <div className="text-sm">
          <span className="mb-1.5 block text-ink-500">{t("common.score")}</span>
          <ScoreBars value={score} onChange={setScore} />
        </div>
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
          <p className="text-sm text-danger">{String(save.error)}</p>
        )}
      </div>
      <div className="mt-3">
        <span id="detail-tags-label" className="mb-1 block text-sm text-ink-500">
          {t("tags.label")}
        </span>
        <TagEditor tags={tags} onChange={setTags} labelledBy="detail-tags-label" />
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
