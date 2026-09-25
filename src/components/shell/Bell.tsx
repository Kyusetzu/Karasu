import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { Bell as BellIcon, CheckCheck } from "lucide-react";
import { isTauri } from "@/api/anilist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MenuGroupLabel } from "@/components/ui/menu-row";
import { Popover } from "@/components/ui/popover";
import { NotifFeed } from "@/components/shell/NotifFeed";
import { useNotifBadge } from "@/hooks/useNotifBadge";
import { useNotifications } from "@/hooks/useNotifications";

/** How many of the newest the titlebar's dropdown shows; the rest are one press away on the notifications page. */
const GLANCE = 3;

/** The titlebar's bell: a glance at the newest few and the way to all of them; the phone has `NotifSheet` instead. */
export default function Bell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const n = useNotifications({ active: open });
  // The one number on the bell, computed once and shared with the phone shell's More button by query key.
  const badge = useNotifBadge();

  if (!isTauri) return null;

  return (
    <Popover
      label={t("notif.title")}
      variant="dropdown"
      align="end"
      width={352}
      onOpen={() => setOpen(true)}
      onClosed={() => setOpen(false)}
      panelClassName="flex flex-col overflow-hidden p-0"
      renderTrigger={(trigger) => (
        <button
          type="button"
          {...trigger}
          aria-label={t("notif.title")}
          title={t("notif.title")}
          className="relative grid h-9 w-11 place-items-center text-ink-500 transition-surface hover:bg-surface-850 hover:text-ink-100 aria-expanded:bg-surface-850 aria-expanded:text-ink-100"
        >
          <BellIcon className="size-4" />
          {badge > 0 && (
            // The floating ring keeps the badge and the bell glyph apart at this size; the pulse stops once read.
            <Badge count={badge} max={9} floating className="animate-idle-pulse right-1.5 top-1.5" />
          )}
        </button>
      )}
    >
      {(api) => (
        <>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-hair py-1.5 pl-3 pr-1.5">
            <MenuGroupLabel className="px-0 pb-0 pt-0">
              {n.unread > 0 ? `${t("notif.title")} · ${n.unread}` : t("notif.title")}
            </MenuGroupLabel>
            {/* Both sides clear here, and the button never hides: a stale badge needs it most. */}
            <Button variant="ghost" size="sm" onClick={() => void n.readAll()}>
              <CheckCheck className="size-3.5" />
              {t("notif.markAll")}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NotifFeed n={n} leave={api.closeThen} limit={GLANCE} />
          </div>
          <div className="shrink-0 border-t border-hair p-1.5">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => (pathname === "/notifications" ? api.close() : api.closeThen(() => navigate("/notifications")))}>
              {t("notif.all")}
            </Button>
          </div>
        </>
      )}
    </Popover>
  );
}
