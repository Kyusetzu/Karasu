import { useTranslation } from "react-i18next";

/**
 * The vocabulary the statistics screen and its panels share.
 *
 * `Category` is the sub-tab; `RankedCategory` is which ranked array a row
 * comes from. They used to be the same union — one tab per array — until the
 * overhaul folded the five ranked lists into two themed tabs, at which point
 * "which screen" and "which data" became different questions.
 */
export type Category = "overview" | "ratings" | "years" | "genresTags" | "people";

export type RankedCategory = "genres" | "tags" | "voiceActors" | "studios" | "staff";

export type SortKey = "count" | "time" | "score";

/** A medium with nothing on the list yet — no panels, just the sentence. */
export function Empty() {
  const { t } = useTranslation();
  return <p className="text-sm text-ink-600">{t("stats.empty")}</p>;
}
