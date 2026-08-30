import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { Season } from "@/api/queries";
import { usePresence } from "@/hooks/usePresence";
import { cn } from "@/lib/utils";

const SEASONS: Season[] = ["WINTER", "SPRING", "SUMMER", "FALL"];

/** Not translated: the kanji is the same in every language Karasu speaks.
 *  Exported for the Wrapped poster's seasonal caption, so the two surfaces
 *  spell a season the same way. */
export const SEASON_KANJI: Record<Season, string> = {
  WINTER: "冬",
  SPRING: "春",
  SUMMER: "夏",
  FALL: "秋",
};

/**
 * Season and year in two clicks.
 *
 * The arrows either side of this reach the next season, which is what they are
 * for. Everything further away is where they fall apart — Spring two years
 * back is nine of them — so the title itself opens a panel: four years, four
 * seasons, any combination in two clicks.
 */
export default function SeasonPicker({
  season,
  year,
  onPick,
  years,
}: {
  season: Season;
  year: number;
  onPick: (next: { season: Season; year: number }) => void;
  /**
   * The years on offer. Defaults to the rolling four-year window the
   * seasonal page browses; Wrapped passes its own list, because a
   * completion history reaches years no rolling window does.
   */
  years?: number[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Exit through `usePresence`, like its sibling `multi-filter-select`: with
  // `{open && …}` alone the panel popped in and vanished mid-frame.
  const panel = usePresence(open);

  // The default years end at the newest season anyone can browse, which is
  // next year's Winter — AniList lists it well before it airs.
  const latest = new Date().getFullYear() + 1;
  const shownYears = years ?? [latest - 3, latest - 2, latest - 1, latest];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg px-2 py-1 transition-surface hover:bg-surface-850"
      >
        <span className="text-lg font-semibold text-ink-100">
          {t(`season.${season}`)} {year}
        </span>
        <span className="font-brand-jp text-xs text-ink-600">
          {SEASON_KANJI[season]}アニメ
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 text-ink-600 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {panel.mounted && (
        // `data-overlay` like every other popover — the Bell, the context menu,
        // the filter selects. Without it the screen-level key handlers stayed
        // live while this was open, so `/` and Ctrl+1/2/3 fired underneath it.
        <div
          data-overlay
          className={cn(
            "absolute left-0 top-full z-10 mt-1.5 w-64 origin-top-left rounded-xl border border-hair bg-surface-900 p-3 shadow-xl panel-wash",
            panel.leaving ? "animate-pop-out" : "animate-pop-in",
          )}
        >
          {/* Wraps rather than stretching: a data-driven year list can hold
              a decade where the default window holds four. */}
          <div className="flex flex-wrap gap-1">
            {shownYears.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => onPick({ season, year: y })}
                className={cn(
                  "min-w-12 flex-1 rounded-md py-1 text-xs tabular-nums transition-surface",
                  y === year
                    ? "bg-accent-500 text-accent-ink"
                    : "text-ink-500 hover:bg-surface-850 hover:text-ink-100",
                )}
              >
                {y}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1">
            {SEASONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  onPick({ season: s, year });
                  setOpen(false);
                }}
                className={cn(
                  "rounded-lg py-2 text-xs font-medium transition-surface",
                  s === season
                    ? "bg-surface-850 text-ink-100"
                    : "text-ink-500 hover:bg-surface-850 hover:text-ink-100",
                )}
              >
                {t(`season.${s}`)}
                <span className="mt-0.5 block font-brand-jp text-2xs text-ink-600">
                  {SEASON_KANJI[s]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
