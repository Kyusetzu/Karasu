import { useTranslation } from "react-i18next";
import { ScoreBars } from "@/components/ui/score-bars";
// The mean formatter, not `formatScore`: an average keeps its decimal and stays numeric on the smiley scale.
import { formatMeanScore } from "@/lib/scoreFormat";
import { useScoreFormat } from "@/stores/auth";
import { anyScored, derivedOverall, orderedCategories } from "@/lib/advancedScores";

/** Per-category scores shared by both editors; names render raw, and the overall is only a preview of the server's. */
export function AdvancedScoreFields({
  categories,
  values,
  onChange,
}: {
  /** The account's names, in the account's order — the write is positional. */
  categories: string[];
  values: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) {
  const { t } = useTranslation();
  const format = useScoreFormat();
  const rows = orderedCategories(categories, values);
  const overall = derivedOverall(rows.map((r) => r.value));

  if (categories.length === 0) return null;

  return (
    <div className="text-sm">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-ink-500">{t("entry.advancedScores")}</span>
        {anyScored(rows.map((r) => r.value)) && (
          <span className="text-2xs text-ink-600">
            {t("entry.advancedDerived", { score: formatMeanScore(format, overall) })}
          </span>
        )}
      </div>
      <div className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.name}>
            <span className="mb-1 block truncate text-xs text-ink-600">
              {row.name}
            </span>
            <ScoreBars
              value={row.value}
              onChange={(v) => onChange({ ...values, [row.name]: v })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
