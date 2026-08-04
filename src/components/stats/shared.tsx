import { useTranslation } from "react-i18next";

/**
 * The vocabulary the statistics screen and its panels share.
 *
 * `Category` is the sub-tab, which is also what decides which ranked array a
 * row comes from, so both the page and the list need it by name.
 */
export type Category =
  | "overview"
  | "genres"
  | "tags"
  | "voiceActors"
  | "studios"
  | "staff";

export type SortKey = "count" | "time" | "score";

/** A medium with nothing on the list yet — no panels, just the sentence. */
export function Empty() {
  const { t } = useTranslation();
  return <p className="text-sm text-ink-600">{t("stats.empty")}</p>;
}
