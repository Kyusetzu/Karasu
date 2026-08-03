import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** How full each bar is drawn, low to high. Ramped rather than linear so the
    control reads as a rising scale at a glance instead of a flat row. */
const FILL = [26, 33, 40, 47, 54, 61, 68, 75, 82, 89];

/**
 * The score, as a ten-bar histogram you can click.
 *
 * A number input states the score; this one shows the *shape* of the scale
 * while setting it, in one gesture and with no dropdown to open. Clicking the
 * current score clears it, which is the only way to say "no score" without a
 * separate control.
 */
export function ScoreBars({
  value,
  onChange,
  className,
}: {
  /** 0 means unscored. */
  value: number;
  onChange: (score: number) => void;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className={className}>
      <div className="flex items-end gap-0.5">
        {FILL.map((fill, i) => {
          const n = i + 1;
          const filled = value > 0 && n <= value;
          return (
            <button
              key={n}
              type="button"
              // Clicking the current score clears it.
              onClick={() => onChange(value === n ? 0 : n)}
              aria-label={String(n)}
              aria-pressed={filled}
              title={String(n)}
              className={cn(
                "flex h-8 w-5.5 items-end justify-center rounded-[.25rem] border transition-surface",
                filled
                  ? "border-surface-700 bg-surface-850"
                  : "border-transparent hover:border-surface-700",
              )}
            >
              <span
                className={cn(
                  "w-full rounded-[.1875rem] transition-[height] duration-160 ease-karasu",
                  filled ? "bg-gold" : "bg-surface-700",
                )}
                style={{ height: `${fill}%` }}
              />
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-2xs text-ink-600">{t("entry.scoreHint")}</p>
    </div>
  );
}
