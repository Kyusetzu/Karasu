import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * The content filter's disclosure line: what was hidden, split the way the
 * filter itself splits — explicit (18+) versus suggestive (Ecchi) — in the
 * settings pane's own vocabulary, linking to where the filter lives. One
 * component for the list, the local library and the search results, so the
 * three sentences cannot drift. Renders nothing when nothing is hidden.
 *
 * Three literal `t()` branches rather than a computed key, the shape
 * `i18nKeys.test.ts` can see.
 */
export function FilteredNotice({
  adult,
  suggestive,
  className,
}: {
  adult: number;
  suggestive: number;
  className?: string;
}) {
  const { t } = useTranslation();
  if (adult + suggestive === 0) return null;
  const text =
    adult > 0 && suggestive > 0
      ? t("list.hiddenBoth", { a: adult, s: suggestive })
      : adult > 0
        ? t("list.hiddenAdult", { n: adult })
        : t("list.hiddenSuggestive", { n: suggestive });
  return (
    <Link
      to="/settings?pane=appearance"
      className={cn(
        "inline-block text-2xs font-medium text-accent-400 hover:underline",
        className,
      )}
    >
      {text}
    </Link>
  );
}
