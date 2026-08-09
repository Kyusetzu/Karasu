import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SCORE_SHOWS_STAR } from "./columns";

/**
 * The ten-point score control, in one component.
 *
 * The row and the bulk bar each had their own copy of the `★ 1 … ★ 10` option
 * list, which is two places for one vocabulary to drift — and the row's copy is
 * where the reported clipping was.
 *
 * The closed display shows the number **without** the star, which is the actual
 * fix for that bug: the `★ ` prefix cost more width than the digit it decorated,
 * so at `10` the label needed more room than the cell had and WebView2 clips a
 * `<select>` rather than ellipsising it. The options keep the star, where there
 * is room for it — see `SCORE_SHOWS_STAR` in `columns.ts`.
 *
 * `tabular-nums` because this is the one numeric cell that changes width with
 * its value, and proportional digits made a `1` and a `7` sit differently.
 */
export function ScoreSelect({
  value,
  onChange,
  className,
  placeholder,
  disabled,
}: {
  /** 0 means unscored. */
  value: number;
  onChange: (score: number) => void;
  className?: string;
  /** For the bulk bar, where nothing is selected yet. */
  placeholder?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const star = SCORE_SHOWS_STAR ? "★ " : "";

  return (
    <select
      value={placeholder !== undefined ? "" : value}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value === "") return;
        onChange(Number(e.target.value));
      }}
      className={cn(
        "h-8 rounded-md border border-surface-800 bg-surface-900 px-2 text-xs tabular-nums text-gold transition-surface focus:border-accent-500 focus:outline-none disabled:opacity-50",
        className,
      )}
      aria-label={t("common.score")}
      title={t("common.score")}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      <option value={0}>–</option>
      {/* A score AniList hands back that is not an integer 1-10 would match no
          option and render the box empty. Ten-point is pinned in every query, so
          this is defensive rather than expected — but an empty score box is
          indistinguishable from an unscored entry, which is the kind of silent
          wrongness worth one line to prevent. */}
      {!Number.isInteger(value) && value > 0 && (
        <option value={value}>{`${star}${value}`}</option>
      )}
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <option key={n} value={n}>
          {`★ ${n}`}
        </option>
      ))}
    </select>
  );
}
