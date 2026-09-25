import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { Season } from "@/api/queries";
import { usePresence } from "@/hooks/usePresence";
import { cn } from "@/lib/utils";

const SEASONS: Season[] = ["WINTER", "SPRING", "SUMMER", "FALL"];

/** Untranslated, since the kanji is the same in every language; exported so Wrapped spells a season the same way. */
export const SEASON_KANJI: Record<Season, string> = {
  WINTER: "冬",
  SPRING: "春",
  SUMMER: "夏",
  FALL: "秋",
};

/** Season and year in two clicks; the arrows reach the next season, and the panel reaches everything further away. */
export default function SeasonPicker({
  season,
  year,
  onPick,
  years,
}: {
  season: Season;
  year: number;
  onPick: (next: { season: Season; year: number }) => void;
  /** The years on offer; defaults to the seasonal page's rolling window, while Wrapped passes its own, longer history. */
  years?: number[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Exit through `usePresence`, since with `{open && …}` alone the panel would vanish mid-frame.
  const panel = usePresence(open);

  // The default years end at next year's Winter, the newest season AniList already lists.
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
        className="flex items-center gap-2 rounded-control px-2 py-1 transition-surface hover:bg-surface-850"
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
        // `data-overlay` like every popover, or the screen-level key handlers stay live and `/` fires underneath it.
        <div
          data-overlay
          className={cn(
            "absolute left-0 top-full z-10 mt-1.5 w-64 origin-top-left rounded-panel border border-hair bg-surface-900 p-3 shadow-float panel-wash",
            panel.leaving ? "animate-pop-out" : "animate-pop-in",
          )}
        >
          {/* Wraps rather than stretching: a data-driven year list can be far longer than the default window. */}
          <div className="flex flex-wrap gap-1">
            {shownYears.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => onPick({ season, year: y })}
                className={cn(
                  "min-w-12 flex-1 rounded-inner border border-transparent py-1 text-xs tabular-nums transition-surface",
                  y === year
                    ? "tint-fill tint-accent text-ink-100"
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
                  "rounded-control py-2 text-xs font-medium transition-surface",
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
