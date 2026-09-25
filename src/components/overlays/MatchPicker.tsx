import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, Search, X } from "lucide-react";
import { searchMedia, sequelsOf } from "@/api/queries";
import { displayTitle, type MediaTitle } from "@/api/types";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked } from "@/lib/contentFilter";
import { formatLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useBackClose } from "@/hooks/useBackClose";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Picks the title a pile of files belongs to, searching all of AniList because the matcher only ever sees the list. */
export default function MatchPicker({
  leaving = false,
  parsedTitle,
  season,
  current,
  error,
  mediaType = "ANIME",
  suggestSequelsOf,
  detectedEpisode,
  onPick,
  onClear,
  onCancel,
}: {
  /** On its way out — supplied by `Presence`. */
  leaving?: boolean;
  parsedTitle: string;
  season: number;
  /** The title this is currently pointed at, if it is pointed anywhere. */
  current?: string;
  /** Why the last pick was rejected. The dialog stays open when one fails. */
  error?: string;
  /** What to search. The library scanner is anime-only; detection is not. */
  mediaType?: "ANIME" | "MANGA";
  /** Offer this entry's sequels above the results; suggested, never applied, since only the viewer knows the season. */
  suggestSequelsOf?: number | null;
  /** The episode the source reported; supplying it adds the "really episode N" field for cour-split servers. */
  detectedEpisode?: number | null;
  /** The chosen id, its display title (so storing the pick needs no request) and, if asked, the real episode. */
  onPick: (mediaId: number, title: string, realEpisode?: number) => void;
  /** Present only when there is a correction to undo. */
  onClear?: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // The search field claims its own focus, which `useDialogFocus` leaves alone.
  useDialogFocus(panel, !leaving);
  useBackClose(!leaving, onCancel);
  const level = useContentFilter((s) => s.level);
  const [term, setTerm] = useState(parsedTitle);
  const [debounced, setDebounced] = useState(parsedTitle);
  // Seeded with what was detected, so leaving it alone means the numbering already agrees.
  const [episode, setEpisode] = useState(
    detectedEpisode != null ? String(detectedEpisode) : "",
  );
  const box = useRef<HTMLInputElement>(null);

  const realEpisode = (() => {
    const n = Math.round(Number(episode));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  useEffect(() => box.current?.focus(), []);

  // Debounced: a request per keystroke would exhaust the AniList rate limit inside one title.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 350);
    return () => clearTimeout(id);
  }, [term]);

  const { data, isFetching, isError } = useQuery({
    queryKey: ["matchSearch", mediaType, debounced],
    queryFn: () => searchMedia(debounced, mediaType),
    enabled: debounced.length > 1,
    staleTime: 5 * 60 * 1000,
  });

  const results = useMemo(
    () => (data?.media ?? []).filter((m) => !isBlocked(m, level)),
    [data, level],
  );

  // One request, on the season the user is being asked about, the same on-demand shape as `SeasonSplitModal`.
  const { data: sequels } = useQuery({
    queryKey: ["sequels", suggestSequelsOf],
    queryFn: () => sequelsOf(suggestSequelsOf!),
    enabled: suggestSequelsOf != null,
    staleTime: 60 * 60 * 1000,
  });

  const suggestions = useMemo(
    () =>
      (sequels ?? [])
        .filter((s) => !isBlocked(s, level))
        .map((s) => ({
          id: s.id,
          title: s.title,
          coverImage: s.coverImage,
          format: s.format,
          episodes: s.episodes,
          seasonYear: s.startDate?.year ?? null,
        })),
    [sequels, level],
  );

  return (
    <div
      data-overlay
      className={cn(
        "fixed inset-0 z-alert grid place-items-center bg-scrim p-4",
        leaving ? "animate-fade-out" : "animate-fade-in",
      )}
      onMouseDown={(e) =>
        !leaving && e.target === e.currentTarget && onCancel()
      }
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "flex max-h-[80vh] w-[34rem] max-w-full flex-col rounded-panel border border-hair bg-surface-900 shadow-float panel-wash",
          leaving ? "animate-settle-out" : "animate-spring-in",
        )}
      >
        <div className="border-b border-hair p-5 pb-4">
          <h2 id={titleId} className="text-sm font-semibold text-ink-100">
            {t("library.pickTitle")}
          </h2>
          {/* The parsed title is the evidence for why this row looks wrong, so it stays on screen. */}
          <p className="mt-1 truncate text-2xs text-ink-600">
            {t("library.parsedAs", {
              title: parsedTitle,
              season: season > 0 ? ` · S${season}` : "",
            })}
          </p>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-600" />
            <Input
              ref={box}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onClear={() => setTerm("")}
              clearLabel={t("common.clear")}
              placeholder={t("library.searchAniList")}
              className="pl-8"
            />
            {isFetching && (
              <Loader2
                className={cn(
                  "absolute top-1/2 size-3.5 -translate-y-1/2 animate-spin text-ink-600",
                  // Left of the clear button whenever there is one.
                  term ? "right-8" : "right-2.5",
                )}
              />
            )}
          </div>
          {/* Only where an episode number is on the table; a library correction settles a whole title. */}
          {detectedEpisode != null && (
            <div className="mt-2 flex items-center gap-2">
              <label className="text-2xs text-ink-500" htmlFor="pick-episode">
                {t("library.reallyEpisode", { n: detectedEpisode })}
              </label>
              <Input
                id="pick-episode"
                type="number"
                min={1}
                value={episode}
                onChange={(e) => setEpisode(e.target.value)}
                className="h-7 w-20"
              />
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {suggestions.length > 0 && (
            <div className="mb-2">
              <p className="px-3 pb-1 pt-1 text-2xs font-semibold uppercase tracking-eyebrow text-ink-600">
                {t("library.laterSeasons")}
              </p>
              <ul className="space-y-0.5">
                {suggestions.map((media) => (
                  <li key={`sequel-${media.id}`}>
                    <ResultRow
                      media={media}
                      isCurrent={displayTitle(media.title) === current}
                      onPick={() =>
                        onPick(media.id, displayTitle(media.title), realEpisode)
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {results.length === 0 ? (
            // A search that never reached AniList is not one that found nothing; asking for a retype spends the budget.
            <p className="px-3 py-6 text-center text-xs text-ink-600">
              {isError
                ? t("library.searchFailed")
                : debounced.length > 1 && !isFetching
                  ? t("library.noResults")
                  : t("library.typeToSearch")}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {results.map((media) => (
                <li key={media.id}>
                  <ResultRow
                    media={media}
                    isCurrent={displayTitle(media.title) === current}
                    onPick={() =>
                      onPick(media.id, displayTitle(media.title), realEpisode)
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-hair p-4">
          {error && (
            <span className="mr-auto min-w-0 flex-1 truncate text-2xs text-danger">
              {error}
            </span>
          )}
          {onClear ? (
            <Button variant="ghost" size="control" onClick={onClear}>
              <X className="size-3.5" />
              {t("library.clearMatch")}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="outline" size="control" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** What a row needs, less than a `Media`, so a sequel candidate carrying `startDate` can use it too. */
export interface PickableMedia {
  id: number;
  title: MediaTitle;
  coverImage: { large: string | null } | null;
  format: string | null;
  episodes: number | null;
  seasonYear?: number | null;
}

function ResultRow({
  media,
  isCurrent,
  onPick,
}: {
  media: PickableMedia;
  isCurrent: boolean;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-3 rounded-control px-3 py-2 text-left transition-colors",
        isCurrent ? "bg-accent-500/12" : "hover:bg-surface-800",
      )}
    >
      {media.coverImage?.large ? (
        <img
          src={media.coverImage.large}
          alt=""
          loading="lazy"
          className="h-12 w-8 shrink-0 rounded-inner object-cover"
        />
      ) : (
        <span className="h-12 w-8 shrink-0 rounded-inner bg-surface-800" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-ink-300">
          {displayTitle(media.title)}
        </span>
        <span className="mt-0.5 block text-2xs text-ink-600">
          {[
            // `formatLabel`, not the raw enum: no AniList enum reaches the screen.
            formatLabel(media.format, t),
            media.seasonYear,
            media.episodes ? t("library.epCount", { n: media.episodes }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      {isCurrent && (
        <span className="shrink-0 text-2xs text-accent-400">
          {t("library.currentMatch")}
        </span>
      )}
    </button>
  );
}
