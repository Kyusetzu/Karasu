import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { NotifFeed } from "@/components/shell/NotifFeed";
import { useNotifications, type Leave } from "@/hooks/useNotifications";
import type { NotifSource } from "@/lib/notifGroups";

/** A page is not an overlay, so a row's destination is simply the next page. */
const stay: Leave = (go) => go();

/** Every notification, Karasu's and AniList's, with a filter by source; the titlebar's dropdown leads here. */
export default function Notifications() {
  const { t } = useTranslation();
  const [source, setSource] = useState<NotifSource>("all");
  const n = useNotifications({ active: true, source });

  return (
    <div className="mx-auto max-w-3xl px-8 pb-12 pt-7">
      {/* Wraps rather than squeezes: at phone width the long German title takes the row and the button moves below. */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            <h1 className="text-title font-bold">{t("notif.title")}</h1>
            {/* The Japanese sub-lockup every other screen header carries. */}
            <span className="whitespace-nowrap font-brand-jp text-ui tracking-lockup text-ink-600">お知らせ</span>
          </div>
          <p className="mt-0.5 text-xs text-ink-600">{t("notif.pageHint")}</p>
        </div>
        <Button variant="secondary" size="sm" className="shrink-0" onClick={() => void n.readAll()}>
          <CheckCheck className="size-3.5" /> {t("notif.markAll")}
        </Button>
      </header>

      {/* Without an AniList account there is one source, and a filter over one source filters nothing. */}
      {n.anilist && (
        <Segmented
          className="mt-5"
          aria-label={t("notif.source")}
          value={source}
          onChange={setSource}
          segments={[
            { value: "all", label: t("notif.sourceAll") },
            { value: "karasu", label: "Karasu" },
            { value: "anilist", label: "AniList" },
          ]}
        />
      )}

      <Card className="mt-4 overflow-hidden p-0">
        <NotifFeed
          n={n}
          leave={stay}
          byDay
          more
          emptyTitle={source === "all" ? undefined : t("notif.emptySource")}
        />
      </Card>
    </div>
  );
}
