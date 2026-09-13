import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  formatScore,
  scoreOptions,
  scoreScale,
  type ScoreFormat,
} from "@/lib/scoreFormat";
import { useScoreFormat } from "@/stores/auth";
import { SCORE_SHOWS_STAR } from "./columns";

/** An option's label inside the open dropdown, where a star fits; the three-point format keeps AniList's smiley. */
function optionLabel(format: ScoreFormat, n: number): string {
  if (format === "POINT_3") return formatScore(format, n);
  return `★ ${formatScore(format, n)}`;
}

/** The bulk bar's score options, the row's vocabulary so the two cannot drift; continuous formats get coarse steps. */
export function bulkScoreOptions(
  format: ScoreFormat,
): { value: string; label: string }[] {
  const options =
    scoreOptions(format) ??
    Array.from(
      { length: 10 },
      (_, i) => ((i + 1) * scoreScale(format).max) / 10,
    );
  return options.map((n) => ({ value: String(n), label: optionLabel(format, n) }));
}

/** The row's score control in the account's format; a continuous one commits a number input on blur, not per keystroke. */
export function ScoreSelect({
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
  const star = SCORE_SHOWS_STAR ? "★ " : "";

  if (options === null) {
    const { max, step, decimals } = scoreScale(format);
    const commit = (raw: string) => {
      const n = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(n)) return;
      const factor = 10 ** decimals;
      const next = Math.max(0, Math.min(max, Math.round(n * factor) / factor));
      if (next !== value) onChange(next);
    };
    return (
      <input
        // Remount on an external change, so a recycled virtual row shows its new entry rather than the last one's draft.
        key={value}
        type="number"
        min={0}
        max={max}
        step={step}
        defaultValue={value > 0 ? value : ""}
        placeholder="–"
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        aria-label={t("common.score")}
        title={t("common.score")}
        className={cn(
          "h-8 rounded-md border border-surface-800 bg-surface-900 px-2 text-xs tabular-nums text-gold transition-surface focus:border-accent-500 focus:outline-none",
          "[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          className,
        )}
      />
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "h-8 rounded-md border border-surface-800 bg-surface-900 px-2 text-xs tabular-nums text-gold transition-surface focus:border-accent-500 focus:outline-none disabled:opacity-50",
        className,
      )}
      aria-label={t("common.score")}
      title={t("common.score")}
    >
      <option value={0}>–</option>
      {/* A value from the previous format, cached across a switch, would render empty like unscored, so it gets an option. */}
      {value > 0 && !options.includes(value) && (
        <option value={value}>{`${star}${formatScore(format, value)}`}</option>
      )}
      {options.map((n) => (
        <option key={n} value={n}>
          {optionLabel(format, n)}
        </option>
      ))}
    </select>
  );
}
