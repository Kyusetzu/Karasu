import { useTranslation } from "react-i18next";
import { formatMeanScore, formatScore, scoreOptions, scoreScale } from "@/lib/scoreFormat";
import { meanPosition, meanScore, scoreBuckets, totalVotes } from "@/lib/scoreDistribution";
import { useScoreFormat } from "@/stores/auth";
import { cn } from "@/lib/utils";

/** A bar's height when nobody has scored the title: the editor's familiar rising ramp. */
const ramp = (i: number, n: number) => (n <= 1 ? 89 : Math.round(26 + (i / (n - 1)) * 63));

/** The score control drawn on the community's own histogram: each bar sets a score, and the bars are everyone else's. */
export function CommunityScore({
  value,
  onChange,
  distribution,
  average,
  className,
}: {
  /** 0 means unscored, in the account's display units. */
  value: number;
  onChange: (score: number) => void;
  distribution: readonly { score: number; amount: number }[] | null | undefined;
  /** AniList's hundred-point community average. */
  average: number | null | undefined;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const format = useScoreFormat();
  const bars = scoreBuckets(format, distribution);
  const votes = totalVotes(bars);
  const peak = Math.max(1, ...bars.map((b) => b.amount));
  const mean = votes > 0 ? meanScore(format, average) : null;
  const continuous = scoreOptions(format) === null;
  const smiley = format === "POINT_3";
  const { max, step } = scoreScale(format);
  // The bar a score lands on; a continuous score between two bars belongs to the lower one.
  const at = value > 0 ? bars.reduce((found, b, i) => (b.value <= value ? i : found), -1) : -1;
  const meanAt = mean === null ? 0 : meanPosition(bars, mean);
  const label = (n: number) => (continuous ? String(n) : formatScore(format, n));
  const columns = { gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` };

  return (
    <div className={className}>
      <div className="mb-2 flex items-end justify-between gap-3">
        <span className="text-sm text-ink-500">{t("common.score")}</span>
        {continuous ? (
          // Remounted on every new value, so the field shows what landed rather than a stale draft.
          <input
            key={value}
            type="number"
            min={0}
            max={max}
            step={step}
            defaultValue={value > 0 ? value : ""}
            placeholder="–"
            aria-label={t("common.score")}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            onBlur={(e) => {
              const raw = e.currentTarget.value === "" ? 0 : Number(e.currentTarget.value);
              if (!Number.isFinite(raw)) return;
              const next = Math.max(0, Math.min(max, raw));
              if (next !== value) onChange(next);
            }}
            className="h-9 w-20 rounded-control border border-surface-700 bg-surface-950 px-2 text-right text-lg font-bold tabular-nums text-gold focus:border-accent-500 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        ) : (
          <span className="leading-none" aria-hidden>
            <span className={cn("text-2xl font-bold tabular-nums", value > 0 && !smiley ? "text-gold" : "text-ink-500")}>
              {formatScore(format, value)}
            </span>
            {!smiley && <span className="ml-1 text-sm text-ink-500">/ {max}</span>}
          </span>
        )}
      </div>

      <div className="grid h-24 items-end gap-1" style={columns}>
        {bars.map((b, i) => {
          const mine = i === at;
          const height = votes > 0 ? Math.max(8, Math.round((b.amount / peak) * 78)) : ramp(i, bars.length);
          return (
            <button
              key={b.value}
              type="button"
              // Pressing the score already given clears it, as the other score controls do.
              onClick={() => onChange(value === b.value ? 0 : b.value)}
              aria-label={label(b.value)}
              aria-pressed={mine}
              className="group relative flex h-full items-end focus-visible:outline-2 focus-visible:outline-accent-500"
            >
              {mine && (
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-inner bg-gold px-1.5 py-0.5 text-xs font-bold leading-none text-gold-ink">
                  {label(b.value)}
                </span>
              )}
              <span
                className={cn(
                  "w-full rounded-t-inner transition-[height,background-color]",
                  mine ? "bg-gold" : i < at ? "bg-gold/55" : "bg-surface-700 group-hover:bg-surface-600",
                )}
                style={{ height: `${height}%` }}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-1 grid gap-1 border-t border-hair pt-1 text-center text-2xs tabular-nums text-ink-500" style={columns} aria-hidden>
        {bars.map((b, i) => (
          <span key={b.value} className={cn(i === at && "font-semibold text-gold")}>
            {label(b.value)}
          </span>
        ))}
      </div>

      {mean !== null && (
        <div className="relative mt-1 h-9">
          <span
            aria-hidden
            className="absolute top-0 size-0 -translate-x-1/2 border-x-[5px] border-b-[6px] border-x-transparent border-b-accent-400"
            style={{ left: `${meanAt * 100}%` }}
          />
          {/* Shifted by its own position, so the label stays inside the row at either end. */}
          <span
            className="absolute top-2 whitespace-nowrap text-2xs text-accent-400"
            style={{ left: `${meanAt * 100}%`, translate: `-${meanAt * 100}% 0` }}
          >
            {t("detail.communityMean", { mean: formatMeanScore(format, mean), count: votes.toLocaleString(i18n.language) })}
          </span>
        </div>
      )}
      <p className="mt-1 text-2xs text-ink-600">{votes > 0 ? t("detail.scoreBarsHint") : t("entry.scoreHint")}</p>
    </div>
  );
}
