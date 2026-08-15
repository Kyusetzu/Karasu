import { useTranslation } from "react-i18next";
import { ScoreBars } from "@/components/ui/score-bars";
// The *mean* formatter, not `formatScore`: this is an average of the
// categories, so it keeps its decimal — and it stays numeric on the smiley
// scale, where "😐, roughly" has no glyph.
import { formatMeanScore } from "@/lib/scoreFormat";
import { useScoreFormat } from "@/stores/auth";
import { anyScored, derivedOverall, orderedCategories } from "@/lib/advancedScores";

/**
 * The per-category scores, for accounts that use advanced scoring.
 *
 * Shared rather than written twice: there are two score-editing surfaces (the
 * entry modal and the detail page's editor) and they already share `ScoreBars`
 * for exactly this reason — anything built into one of them disagrees with the
 * other about the same entry.
 *
 * The category names are the user's own free text, rendered raw. A
 * `t(\`entry.advanced.\${name}\`)` would be invisible to `i18nKeys.test.ts`
 * *and* would render the key on screen for anyone whose categories are not
 * AniList's five defaults.
 *
 * The overall score is a **preview**. AniList derives it from these on the
 * server, so the number shown here is what the mean says and the number that
 * sticks is what the mutation answers with — which is why the caller
 * reconciles from the result rather than trusting an optimistic patch.
 */
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
