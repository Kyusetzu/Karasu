import { useTranslation } from "react-i18next";
import { formatScore, scoreOptions, scoreScale } from "@/lib/scoreFormat";
import { useScoreFormat } from "@/stores/auth";
import { cn } from "@/lib/utils";

/** How full each bar is drawn, low to high — resampled to however many bars
    the active format has, so a five-star scale still reads as a rising ramp. */
const FILL_RANGE: [number, number] = [26, 89];

function fillFor(index: number, count: number): number {
  if (count <= 1) return FILL_RANGE[1];
  const [lo, hi] = FILL_RANGE;
  return Math.round(lo + (index / (count - 1)) * (hi - lo));
}

/**
 * The score control of the entry editor, in the account's own format.
 *
 * Discrete formats (10, 5, 3) keep the clickable histogram — it shows the
 * *shape* of the scale while setting it, and clicking the current score
 * clears it, which is the only way to say "no score" without a separate
 * control. The smiley scale labels its three bars with the smileys AniList
 * itself uses. The two continuous formats (100 and 10-decimal) get a number
 * input instead: a hundred bars is not a control.
 */
export function ScoreBars({
  value,
  onChange,
  className,
}: {
  /** 0 means unscored, in the account's display units. */
  value: number;
  onChange: (score: number) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const format = useScoreFormat();
  const options = scoreOptions(format);

  if (options === null) {
    const { max, step, decimals } = scoreScale(format);
    return (
      <div className={className}>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={max}
            step={step}
            value={value > 0 ? value : ""}
            placeholder="–"
            onChange={(e) => {
              const raw = e.target.value === "" ? 0 : Number(e.target.value);
              if (!Number.isFinite(raw)) return;
              const factor = 10 ** decimals;
              onChange(Math.max(0, Math.min(max, Math.round(raw * factor) / factor)));
            }}
            aria-label={t("common.score")}
            className="h-8 w-24 rounded-md border border-surface-700 bg-surface-950 px-2 text-sm tabular-nums text-gold focus:border-accent-500 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="text-xs text-ink-600">/ {max}</span>
        </div>
        <p className="mt-1.5 text-2xs text-ink-600">{t("entry.scoreHintInput")}</p>
      </div>
    );
  }

  const smiley = format === "POINT_3";

  return (
    <div className={className}>
      <div className="flex items-end gap-0.5">
        {options.map((n, i) => {
          const filled = value > 0 && n <= value;
          const label = smiley ? formatScore(format, n) : String(n);
          return (
            <button
              key={n}
              type="button"
              // Clicking the current score clears it.
              onClick={() => onChange(value === n ? 0 : n)}
              aria-label={label}
              aria-pressed={filled}
              title={label}
              className={cn(
                "flex items-end justify-center rounded-[.25rem] border transition-surface",
                smiley ? "h-9 w-9" : "h-8 w-5.5",
                filled
                  ? "border-surface-700 bg-surface-850"
                  : "border-transparent hover:border-surface-700",
              )}
            >
              {smiley ? (
                <span
                  className={cn(
                    "pb-1.5 text-base leading-none transition-opacity",
                    filled ? "opacity-100" : "opacity-35",
                  )}
                >
                  {label}
                </span>
              ) : (
                <span
                  className={cn(
                    "w-full rounded-[.1875rem] transition-[height] duration-160 ease-karasu",
                    filled ? "bg-gold" : "bg-surface-700",
                  )}
                  style={{ height: `${fillFor(i, options.length)}%` }}
                />
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-2xs text-ink-600">{t("entry.scoreHint")}</p>
    </div>
  );
}
