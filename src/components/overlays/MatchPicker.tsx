import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { searchMedia, sequelsOf } from "@/api/queries";
import { displayTitle, type MediaTitle } from "@/api/types";
import { useContentFilter } from "@/stores/contentFilter";
import { isBlocked } from "@/lib/contentFilter";
import { formatLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MenuGroupLabel, MenuRow } from "@/components/ui/menu-row";
import { Modal } from "@/components/ui/modal";
import { SearchField } from "@/components/ui/search-field";
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

  // The search field takes the caret over the dialog's first control, since typing is what the dialog is for.
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
    <Modal
      title={t("library.pickTitle")}
      // The parsed title is the evidence for why this row looks wrong, so it stays on screen.
      description={t("library.parsedAs", {
        title: parsedTitle,
        season: season > 0 ? ` · S${season}` : "",
      })}
      size="xl"
      onClose={onCancel}
      leaving={leaving}
      bodyClassName="flex flex-col overflow-hidden p-0"
      footer={
        <>
          {error && <span className="mr-auto min-w-0 flex-1 truncate text-2xs text-danger">{error}</span>}
          {onClear && (
            <Button variant="ghost" size="control" className={cn(!error && "mr-auto")} onClick={onClear}>
              <X className="size-3.5" />
              {t("library.clearMatch")}
            </Button>
          )}
          <Button variant="outline" size="control" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      <div className="shrink-0 border-b border-hair px-5 pb-4 pt-3">
        <SearchField
          value={term}
          onChange={setTerm}
          inputRef={box}
          busy={isFetching}
          label={t("library.searchAniList")}
          clearLabel={t("common.clear")}
          placeholder={t("library.searchAniList")}
        />
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
            <MenuGroupLabel>{t("library.laterSeasons")}</MenuGroupLabel>
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
    </Modal>
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
    <MenuRow
      current={isCurrent}
      onClick={onPick}
      lead={
        media.coverImage?.large ? (
          <img src={media.coverImage.large} alt="" loading="lazy" className="h-12 w-8 shrink-0 rounded-inner object-cover" />
        ) : (
          <span className="h-12 w-8 shrink-0 rounded-inner bg-surface-800" />
        )
      }
      trailing={isCurrent && <span className="shrink-0 text-2xs text-accent-400">{t("library.currentMatch")}</span>}
    >
      <span className="block truncate">{displayTitle(media.title)}</span>
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
    </MenuRow>
  );
}
