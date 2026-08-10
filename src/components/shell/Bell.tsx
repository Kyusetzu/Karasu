import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Bell as BellIcon, CalendarClock, Clock, Film } from "lucide-react";
import { EmptyState, TickMarks } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { usePresence } from "@/hooks/usePresence";
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

/**
 * Each kind of notice gets its own tint, because they are not the same news:
 * an episode is out (accent — act on it), something has gone quiet (ink — a
 * fact about you), a sequel was announced (green — good news, nothing to do).
 */
const KIND_TINT: Record<string, string> = {
  airing: "bg-accent-500/14 text-accent-400",
  stale: "bg-surface-800 text-ink-500",
  sequel: "bg-success/14 text-success",
};
const DEFAULT_TINT = "bg-surface-800 text-ink-500";

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
  const panel = usePresence(open);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!isTauri) return;
    getNotifications().then(setItems).catch(() => {});
  }, []);

  // `load` guards itself, but `listen` does not — outside Tauri it reaches for
  // `__TAURI_INTERNALS__.transformCallback` and throws. That throw is in a
  // passive effect during mount, so the shell's ErrorBoundary catches it and
  // the *whole window* renders as the error screen: `npm run dev` in a plain
  // browser showed an empty page, and nothing pointed at the bell.
  useEffect(() => {
    if (!isTauri) return;
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

  const groups: [string, AppNotification[]][] = [
    ["notif.groupNew", items.filter((n) => !n.read)],
    ["notif.groupEarlier", items.filter((n) => n.read)],
  ];

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
          // Breathes while there is something unread. The count is small and
          // sits in the corner of a quiet titlebar, so a badge that merely
          // appears is easy to walk past; this stops the moment it is read.
          <span className="animate-idle-pulse absolute right-1.5 top-1.5 grid h-3.25 min-w-3.25 place-items-center rounded-[.4375rem] border border-surface-950 bg-accent-500 px-1 text-[.5625rem] font-semibold text-accent-ink">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {panel.mounted && (
        <div
          className={cn(
            "absolute right-0 top-full z-50 mt-1 w-88 origin-top-right overflow-hidden rounded-xl border border-hair bg-surface-900 shadow-2xl panel-wash",
            panel.leaving ? "animate-pop-out" : "animate-spring-in",
          )}
        >
          <div className="flex items-center justify-between border-b border-hair px-3 py-2">
            <span className="flex items-baseline gap-2">
              <span className="text-2xs font-semibold uppercase tracking-[.14em] text-ink-600">
                {t("notif.title")}
              </span>
              {unread > 0 && (
                <span className="text-2xs tabular-nums text-ink-500">{unread}</span>
              )}
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
            <EmptyState visual={<TickMarks />} title={t("notif.empty")} className="py-6" />
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {/* Unread first under their own heading. One flat stream by time
                  buries a new episode under last week's read notices, which is
                  the only thing anyone opens this for. */}
              {groups.map(([label, list]) =>
                list.length === 0 ? null : (
                  <section key={label}>
                    <h3 className="px-3 pb-1 pt-2.5 text-[.5625rem] font-semibold uppercase tracking-[.14em] text-ink-600">
                      {t(label)}
                    </h3>
                    <ul>
                      {list.map((n) => {
                        const Icon = KIND_ICON[n.kind] ?? BellIcon;
                        return (
                          <li key={n.id}>
                            <button
                              onClick={() => readOne(n)}
                              className={cn(
                                "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-surface hover:bg-surface-850",
                                !n.read && "bg-[rgba(255,255,255,.018)]",
                              )}
                            >
                              <span
                                className={cn(
                                  "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md",
                                  KIND_TINT[n.kind] ?? DEFAULT_TINT,
                                )}
                              >
                                <Icon className="size-3.25" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                  <span className="truncate text-[.8125rem] font-medium text-ink-100">
                                    {n.title}
                                  </span>
                                  {!n.read && (
                                    <span className="size-1.5 shrink-0 rounded-full bg-accent-500" />
                                  )}
                                </span>
                                <span className="mt-0.5 block text-xs text-ink-500">
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
                  </section>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
