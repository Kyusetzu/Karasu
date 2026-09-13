import { useTranslation } from "react-i18next";

/** The statistics sub-tab, a different question from `RankedCategory`, which names the ranked array a row comes from. */
export type Category = "overview" | "ratings" | "years" | "genresTags" | "people";

export type RankedCategory = "genres" | "tags" | "voiceActors" | "studios" | "staff";

export type SortKey = "count" | "time" | "score";

/** A medium with nothing on the list yet — no panels, just the sentence. */
export function Empty() {
  const { t } = useTranslation();
  return <p className="text-sm text-ink-600">{t("stats.empty")}</p>;
}
