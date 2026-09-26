import { useTranslation } from "react-i18next";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { NotifFeed } from "@/components/shell/NotifFeed";
import { afterBackSettles } from "@/hooks/useBackClose";
import { useNotifications, type Leave } from "@/hooks/useNotifications";

/** The phone's bell: a tall sheet of its own, today above earlier, which the More sheet steps aside for. */
export default function NotifSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const n = useNotifications({ active: open });
  // The sheet's back entry unwinds first, or the page it opens would be the entry the next back press undoes.
  const leave: Leave = (go) => {
    onClose();
    afterBackSettles(go);
  };

  return (
    <Sheet open={open} label={t("notif.title")} tall onClose={onClose} className="flex flex-col overflow-hidden px-0 pb-0">
      <div className="flex shrink-0 items-center justify-between gap-3 pb-2 pl-4 pr-2">
        <h2 className="text-base text-ink-100">{t("notif.title")}</h2>
        <Button variant="ghost" size="sm" onClick={() => void n.readAll()}>
          <CheckCheck className="size-3.5" />
          {t("notif.markAll")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-hair">
        <NotifFeed n={n} leave={leave} byDay more />
      </div>
    </Sheet>
  );
}
