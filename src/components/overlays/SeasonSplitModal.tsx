import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { searchMedia, sequelsOf, type SequelCandidate } from "@/api/queries";
import type { Overflow } from "@/api/library";
import { isTauri } from "@/api/anilist";
import { displayTitle } from "@/api/types";
import { previewMapping } from "@/lib/seasonSplit";
import { isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { Shimmer } from "@/components/Skeleton";
import { cn } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";

/** The season-split confirmation; the relations hint is pre-selected but never applied on its own (always ask). */

export interface SplitTarget {
  /** The row being split — the command is keyed on it, not on a parse. */
  mediaId: number;
  /** Display title of the currently matched entry. */
  title: string;
  overflow: Overflow;
  /** Highest episode the row shows (current frame, like `firstExtra`). */
  maxEpisode: number;
}

interface Choice {
  mediaId: number;
  dstStart: number;
  label: string;
  episodes: number | null;
  year: number | null;
  cover: string | null;
  fromRules: boolean;
}

export function SeasonSplitModal({
  target,
  onConfirm,
  onClose,
  error,
  pending,
  leaving,
}: {
  target: SplitTarget;
  /** Hands the answer to the page, which owns the command; the label lets its success toast name the show. */
  onConfirm: (mediaId: number, dstStart: number, label: string) => void;
  onClose: () => void;
  error: string | null;
  pending: boolean;
  leaving?: boolean;
}) {
  const { t } = useTranslation();
  const level = useContentFilter((s) => s.level);
  const [selected, setSelected] = useState<Choice | null>(null);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  const { overflow, maxEpisode } = target;
  const from = overflow.firstExtra;

  const sequels = useQuery({
    queryKey: ["sequels", target.mediaId],
    queryFn: () => sequelsOf(target.mediaId),
    enabled: isTauri,
    staleTime: 60 * 60 * 1000,
  });

  // Debounced like MatchPicker: a search per keystroke spends the shared rate limit on half-typed words.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 350);
    return () => clearTimeout(timer);
  }, [term]);

  const search = useQuery({
    queryKey: ["splitSearch", debounced],
    queryFn: () => searchMedia(debounced, "ANIME"),
    enabled: isTauri && debounced.length >= 2,
    staleTime: 5 * 60 * 1000,
  });

  const candidates: Choice[] = useMemo(() => {
    const toChoice = (m: SequelCandidate): Choice => ({
      mediaId: m.id,
      // The community rules may renumber into a mid-count start (a split-cour second half); everything else begins at 1.
      dstStart:
        overflow.hint && overflow.hint.mediaId === m.id ? overflow.hint.dstStart : 1,
      label: displayTitle(m.title),
      episodes: m.episodes,
      year: m.startDate?.year ?? null,
      cover: m.coverImage?.large ?? null,
      fromRules: overflow.hint?.mediaId === m.id,
    });
    return (sequels.data ?? [])
      .filter((m) => !isBlocked(m, level))
      .map(toChoice);
  }, [sequels.data, overflow.hint, level]);

  // Pre-select what the rules point at, once the candidates exist.
  useEffect(() => {
    if (selected) return;
    const hinted = candidates.find((c) => c.fromRules);
    if (hinted) setSelected(hinted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  const searchChoices: Choice[] = (search.data?.media ?? [])
    .filter((m) => !isBlocked(m, level) && m.id !== target.mediaId)
    .slice(0, 5)
    .map((m) => ({
      mediaId: m.id,
      dstStart: 1,
      label: displayTitle(m.title),
      episodes: m.episodes,
      year: m.seasonYear ?? null,
      cover: m.coverImage?.large ?? null,
      fromRules: false,
    }));

  const preview = selected ? previewMapping(from, maxEpisode, selected.dstStart) : null;

  const row = (c: Choice) => (
    <button
      key={c.mediaId}
      type="button"
      onClick={() => setSelected(c)}
      aria-pressed={selected?.mediaId === c.mediaId}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-control border px-2.5 py-2 text-left transition-surface",
        selected?.mediaId === c.mediaId
          ? "border-accent-500 bg-accent-500/10"
          : "border-hair hover:border-surface-600",
      )}
    >
      <div className="h-12 w-8 shrink-0 overflow-hidden rounded-inner bg-surface-850">
        {c.cover && <img src={c.cover} alt="" loading="lazy" className="size-full object-cover" />}
      </div>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink-100">{c.label}</span>
        <span className="block text-2xs text-ink-600">
          {[
            c.episodes !== null ? t("library.splitEpisodes", { n: c.episodes }) : null,
            c.year,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      {c.fromRules && (
        <Chip tone="accent" size="xs">
          {t("library.splitRuleHint")}
        </Chip>
      )}
    </button>
  );

  return (
    <Modal
      title={t("library.splitTitle")}
      onClose={onClose}
      leaving={leaving}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            disabled={!selected || pending}
            onClick={() =>
              selected && onConfirm(selected.mediaId, selected.dstStart, selected.label)
            }
          >
            {pending ? t("library.splitApplying") : t("library.splitConfirm")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-300">
          {t("library.splitFacts", {
            title: target.title,
            files: overflow.extraFiles,
            known: overflow.knownEpisodes,
            from,
            to: maxEpisode,
          })}
        </p>

        <div>
          <p className="text-xs font-medium text-ink-300">{t("library.splitCandidates")}</p>
          <div className="mt-1.5 space-y-1.5">
            {sequels.isLoading ? (
              <Shimmer className="h-16 w-full rounded-control" />
            ) : candidates.length ? (
              candidates.map(row)
            ) : (
              <p className="text-xs text-ink-600">{t("library.splitNoSequels")}</p>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-ink-300">{t("library.splitSearch")}</p>
          <SearchField
            value={term}
            onChange={setTerm}
            label={t("library.splitSearch")}
            clearLabel={t("common.clear")}
            placeholder={t("library.splitSearchPlaceholder")}
            className="mt-1.5"
          />
          {searchChoices.length > 0 && (
            <div className="mt-1.5 space-y-1.5">{searchChoices.map(row)}</div>
          )}
        </div>

        {preview && selected && (
          <div className="rounded-control border border-hair bg-surface-950 px-3 py-2 text-xs tabular-nums text-ink-300">
            {preview.shown.map((p) => (
              <p key={p.disk} className="flex items-center gap-1.5">
                {t("library.ep", { n: p.disk })}
                <ArrowRight className="size-3 text-ink-600" />
                {t("library.splitBecomes", { n: p.renumbered, title: selected.label })}
              </p>
            ))}
            {preview.hidden > 0 && <p className="text-ink-600">… {preview.hidden} …</p>}
            {preview.last && (
              <p className="flex items-center gap-1.5">
                {t("library.ep", { n: preview.last.disk })}
                <ArrowRight className="size-3 text-ink-600" />
                {t("library.splitBecomes", { n: preview.last.renumbered, title: selected.label })}
              </p>
            )}
          </div>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
