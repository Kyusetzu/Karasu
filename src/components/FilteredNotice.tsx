import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** The content filter's one disclosure line, shared by the three surfaces so their sentences cannot drift. */
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
  // Three literal `t()` calls, never a computed key: `i18nKeys.test.ts` can only see literal keys.
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
