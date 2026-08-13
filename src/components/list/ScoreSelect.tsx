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

/**
 * The label an option carries inside the open dropdown, where there is room
 * for decoration: a star for the two star scales, AniList's smiley for the
 * three-point one, the bare number for everything else.
 */
function optionLabel(format: ScoreFormat, n: number): string {
  if (format === "POINT_3") return formatScore(format, n);
  return `★ ${formatScore(format, n)}`;
}

/**
 * The score options the bulk bar renders through its own `FilterSelect` — the
 * same vocabulary as the row control, so the two cannot drift. The continuous
 * formats get ten coarse steps: a bulk write over a selection is a coarse
 * gesture, and a hundred-option dropdown is not a control.
 */
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

/**
 * The row's score control, in the account's own format.
 *
 * Discrete formats (10, 5, 3) render a `<select>` whose options come from
 * `scoreOptions`, so the row and the bulk bar share one vocabulary. The two
 * continuous formats (100 and 10-decimal) get a number input instead —
 * committed on blur or Enter, because a virtualized row saving on every
 * keystroke would write `8`, then `85`, on the way to `85`.
 *
 * The closed select shows the number **without** the star — the `★ ` prefix
 * cost more width than the digit it decorated, so at `10` the label needed
 * more room than the cell had and WebView2 clips a `<select>` rather than
 * ellipsising it. The options keep the star, where there is room for it —
 * see `SCORE_SHOWS_STAR` in `columns.ts`.
 *
 * `tabular-nums` because this is the one numeric cell that changes width with
 * its value, and proportional digits made a `1` and a `7` sit differently.
 */
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
        // Remount on an external change so a recycled virtual row shows the
        // entry it now renders rather than the last one's draft.
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
      {/* A cached entry can briefly hold a value from the *previous* format —
          the account was just switched and the refetch has not landed. A value
          outside the option list would render the box empty, which is
          indistinguishable from unscored, so it gets a transitional option. */}
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
