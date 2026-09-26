import { useTranslation } from "react-i18next";
import type { MediaType } from "@/api/types";
import { shows, templateColumns, type Tier } from "./columns";

/** Column labels outside `VirtualGrid`, so they never scroll away, sharing `templateColumns` so widths cannot drift. */
export function ListHeader({
  tier,
  selectMode,
  mediaType,
  cover = true,
}: {
  tier: Tier;
  selectMode: boolean;
  mediaType: MediaType;
  /** False over the text list, so the header's tracks match its collapsed cover column. */
  cover?: boolean;
}) {
  const { t } = useTranslation();
  const manga = mediaType === "MANGA";

  return (
    <div
      className="sticky top-0 z-10 grid items-end gap-x-2.5 border-b border-hair bg-surface-950/95 px-3.5 pb-1.5 pt-1 text-2xs uppercase text-ink-600 backdrop-blur"
      style={{ gridTemplateColumns: templateColumns({ tier, selectMode, manga, cover }) }}
    >
      <span />
      <span />
      <span className="truncate">{t("list.colTitle")}</span>
      <span className="truncate">{shows(tier, "status") ? t("common.status") : ""}</span>
      {/* Its own short word: the score column is sized for a figure, and the general label ran past it in German. */}
      <span className="truncate">{t("list.colScore")}</span>
      <span className="truncate">
        {manga ? t("common.chapters") : t("common.episodes")}
      </span>
      <span className="truncate">
        {shows(tier, "volumes") && manga ? t("common.volumes") : ""}
      </span>
      <span className="truncate text-right">
        {shows(tier, "repeat") ? t("list.colRepeat") : ""}
      </span>
      <span className="truncate">{shows(tier, "dates") ? t("list.colDates") : ""}</span>
      <span className="truncate text-right">
        {shows(tier, "tags") ? t("list.colTags") : ""}
      </span>
      <span />
    </div>
  );
}
