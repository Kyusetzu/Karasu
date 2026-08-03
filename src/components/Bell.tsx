import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Bell as BellIcon, CalendarClock, Clock, Film } from "lucide-react";
import {
  getNotifications,
  isTauri,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "@/api/anilist";

const KIND_ICON: Record<string, typeof BellIcon> = {
  airing: CalendarClock,
  stale: Clock,
  sequel: Film,
};

function relTime(ms: number, lang: string, nowLabel: string): string {
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return nowLabel;
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ms).toLocaleDateString(lang);
}

export default function Bell() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!isTauri) return;
    getNotifications().then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const un = listen("notifications-changed", () => load());
    return () => {
      un.then((f) => f());
    };
  }, [load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = items.filter((n) => !n.read).length;

  const readOne = async (n: AppNotification) => {
    if (n.read) return;
    await markNotificationRead(n.id).catch(() => {});
    load();
  };

  const readAll = async () => {
    await markAllNotificationsRead().catch(() => {});
    load();
  };

  if (!isTauri) return null;

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-9 w-11 place-items-center text-ink-500 transition-surface hover:bg-surface-850 hover:text-ink-100"
        aria-label={t("notif.title")}
        title={t("notif.title")}
      >
        <BellIcon className="size-3.75" />
        {unread > 0 && (
          // The `s950` ring is what separates the badge from the bell glyph
          // beneath it — without it the two silhouettes merge at this size.
          <span className="absolute right-1.5 top-1.5 grid h-3.25 min-w-3.25 place-items-center rounded-[.4375rem] border border-surface-950 bg-accent-500 px-1 text-[.5625rem] font-semibold text-accent-ink">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-surface-800 px-3 py-2">
            <span className="text-sm font-semibold text-ink-100">
              {t("notif.title")}
            </span>
            {unread > 0 && (
              <button
                onClick={readAll}
                className="text-xs text-accent-400 hover:underline"
              >
                {t("notif.markAll")}
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-600">
              {t("notif.empty")}
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => {
                const Icon = KIND_ICON[n.kind] ?? BellIcon;
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => readOne(n)}
                      className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-surface-850 ${
                        n.read ? "opacity-60" : ""
                      }`}
                    >
                      <span className="mt-0.5 text-accent-400">
                        <Icon className="size-3.75" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-ink-100">
                            {n.title}
                          </span>
                          {!n.read && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-400">
                          {n.body}
                        </span>
                        <span className="mt-0.5 block text-2xs text-ink-600">
                          {relTime(n.createdMs, i18n.language, t("notif.now"))}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
