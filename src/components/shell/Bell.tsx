import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import {
  Bell as BellIcon,
  CalendarClock,
  ChevronRight,
  Clock,
  Film,
  Heart,
  MessageCircle,
  UserPlus,
} from "lucide-react";
import { EmptyState, TickMarks } from "@/components/EmptyState";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/Skeleton";
import { cn } from "@/lib/utils";
import { relTime, relTimeFromSeconds } from "@/lib/relTime";
import { usePresence } from "@/hooks/usePresence";
import { useAuth } from "@/stores/auth";
import {
  getNotifications,
  isTauri,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "@/api/anilist";
import { siteNotifCount, siteNotifications, type SiteNotifPage } from "@/api/social";
import type { SiteNotifKind, SiteNotifRow } from "@/lib/siteNotifications";

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

/** The site view reuses the same vocabulary: an episode is still accent, a
    person is green, a like is a heart, talk is quiet ink, site housekeeping
    is a film reel. Grouped by what the news *is*, not by API type. */
const SITE_ICON: Record<SiteNotifKind, typeof BellIcon> = {
  AIRING: CalendarClock,
  FOLLOWING: UserPlus,
  ACTIVITY_MENTION: MessageCircle,
  ACTIVITY_REPLY: MessageCircle,
  ACTIVITY_REPLY_SUBSCRIBED: MessageCircle,
  ACTIVITY_LIKE: Heart,
  ACTIVITY_REPLY_LIKE: Heart,
  THREAD_COMMENT_MENTION: MessageCircle,
  THREAD_COMMENT_REPLY: MessageCircle,
  THREAD_SUBSCRIBED: MessageCircle,
  THREAD_COMMENT_LIKE: Heart,
  THREAD_LIKE: Heart,
  RELATED_MEDIA_ADDITION: Film,
  MEDIA_DATA_CHANGE: Film,
  MEDIA_MERGE: Film,
  MEDIA_DELETION: Film,
  MEDIA_SUBMISSION_UPDATE: Film,
  STAFF_SUBMISSION_UPDATE: Film,
  CHARACTER_SUBMISSION_UPDATE: Film,
};

const SITE_TINT: Record<SiteNotifKind, string> = {
  AIRING: "bg-accent-500/14 text-accent-400",
  FOLLOWING: "bg-success/14 text-success",
  ACTIVITY_MENTION: "bg-surface-800 text-ink-500",
  ACTIVITY_REPLY: "bg-surface-800 text-ink-500",
  ACTIVITY_REPLY_SUBSCRIBED: "bg-surface-800 text-ink-500",
  ACTIVITY_LIKE: "bg-danger/14 text-danger",
  ACTIVITY_REPLY_LIKE: "bg-danger/14 text-danger",
  THREAD_COMMENT_MENTION: "bg-surface-800 text-ink-500",
  THREAD_COMMENT_REPLY: "bg-surface-800 text-ink-500",
  THREAD_SUBSCRIBED: "bg-surface-800 text-ink-500",
  THREAD_COMMENT_LIKE: "bg-danger/14 text-danger",
  THREAD_LIKE: "bg-danger/14 text-danger",
  RELATED_MEDIA_ADDITION: "bg-gold/14 text-gold",
  MEDIA_DATA_CHANGE: "bg-gold/14 text-gold",
  MEDIA_MERGE: "bg-gold/14 text-gold",
  MEDIA_DELETION: "bg-gold/14 text-gold",
  MEDIA_SUBMISSION_UPDATE: "bg-gold/14 text-gold",
  STAFF_SUBMISSION_UPDATE: "bg-gold/14 text-gold",
  CHARACTER_SUBMISSION_UPDATE: "bg-gold/14 text-gold",
};

/** Literal `t()` per case, so `i18nKeys.test.ts` sees every key. AniList's own
    `context` strings are English-only compositions and are never rendered. */
function siteVerb(
  row: SiteNotifRow,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  const name = row.actorName ?? "—";
  switch (row.kind) {
    case "AIRING":
      return t("notif.siteAiring", { n: row.episode ?? 0 });
    case "FOLLOWING":
      return t("notif.siteFollowing");
    case "ACTIVITY_MENTION":
      return t("notif.siteActivityMention");
    case "ACTIVITY_REPLY":
      return t("notif.siteActivityReply");
    case "ACTIVITY_REPLY_SUBSCRIBED":
      return t("notif.siteActivityReplySubscribed");
    case "ACTIVITY_LIKE":
      return t("notif.siteActivityLike");
    case "ACTIVITY_REPLY_LIKE":
      return t("notif.siteActivityReplyLike");
    case "THREAD_COMMENT_MENTION":
      return t("notif.siteThreadMention", { name });
    case "THREAD_COMMENT_REPLY":
      return t("notif.siteThreadReply", { name });
    case "THREAD_SUBSCRIBED":
      return t("notif.siteThreadSubscribed", { name });
    case "THREAD_COMMENT_LIKE":
      return t("notif.siteThreadCommentLike", { name });
    case "THREAD_LIKE":
      return t("notif.siteThreadLike", { name });
    case "RELATED_MEDIA_ADDITION":
      return t("notif.siteRelatedAdded");
    case "MEDIA_DATA_CHANGE":
      return t("notif.siteDataChange");
    case "MEDIA_MERGE":
      return t("notif.siteMerge");
    case "MEDIA_DELETION":
      return t("notif.siteDeleted");
    case "MEDIA_SUBMISSION_UPDATE":
      return t("notif.siteSubmissionMedia");
    case "STAFF_SUBMISSION_UPDATE":
      return t("notif.siteSubmissionStaff");
    case "CHARACTER_SUBMISSION_UPDATE":
      return t("notif.siteSubmissionCharacter");
  }
}

export default function Bell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const mode = useAuth((s) => s.mode);
  // Part of both AniList query keys below. Without it, sign out of A and into
  // B within a staleTime and B's badge shows A's count — and the open nudge
  // then jumps B to the AniList tab on the strength of A's notifications.
  const viewerId = useAuth((s) => s.viewer?.id ?? null);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"local" | "site">("local");
  const panel = usePresence(open);
  const ref = useRef<HTMLDivElement>(null);

  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!isTauri) return;
    // A swallowed failure rendered the empty state, so a bell that could not
    // read its own table said "You're all caught up." — the most reassuring
    // possible way to report a broken database.
    getNotifications()
      .then((rows) => {
        setItems(rows);
        setLoadError(null);
      })
      .catch((e) => setLoadError(String(e)));
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

  const anilist = mode === "anilist";

  // One scalar off the viewer. It used to be gated on `open`, which meant it
  // could never feed the always-visible badge — so an account with twelve
  // AniList notifications and no Karasu ones showed no badge at all, and
  // opening the bell landed on an empty tab.
  //
  // The badge has to keep being true after startup, and nothing else ever
  // touches this key: with `refetchOnWindowFocus` off globally and the bell
  // mounted exactly once, `staleTime` alone would freeze the badge at its
  // boot value for the whole session. Hence the interval — six requests an
  // hour against a ~30/minute budget — and a refetch on every open (below),
  // which is the freshness the old `enabled: open` gate used to provide.
  // The feed's mark-seen still zeroes it the moment it is actually read.
  const count = useQuery({
    queryKey: ["social", "notifCount", viewerId],
    queryFn: siteNotifCount,
    enabled: isTauri && anilist,
    staleTime: 60_000,
    refetchInterval: 10 * 60_000,
  });

  // The feed itself costs a request only when the AniList view is chosen —
  // the second user-initiated moment. The first page passes `reset`, which is
  // AniList's own mark-seen; when that page lands, the count is zeroed right
  // here in the resolution path — cancel first, the house rule for every
  // optimistic write, because an in-flight count read that was computed
  // before the reset would otherwise land afterwards and resurrect the chip.
  const site = useInfiniteQuery({
    queryKey: ["social", "siteNotifs", viewerId],
    queryFn: async ({ pageParam }) => {
      const reset = pageParam === 1;
      const page = await siteNotifications(pageParam, reset);
      if (reset) {
        await qc.cancelQueries({ queryKey: ["social", "notifCount", viewerId] });
        qc.setQueryData(["social", "notifCount", viewerId], 0);
      }
      return page;
    },
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.pageInfo.hasNextPage ? all.length + 1 : undefined),
    enabled: isTauri && open && anilist && view === "site",
    staleTime: 60_000,
  });

  // Trim retained pages when the panel closes, so a later stale open refetches
  // one page rather than every page the last session walked — the infinite-
  // query trap `UserList` documents, stepped around the way `Thread` does.
  // The fetch-time clock is preserved on purpose: `setQueryData` stamps "now"
  // by default, and a trim is housekeeping, not fresh data — restamping would
  // postpone the reopen refetch (and its mark-seen) for as long as the user
  // keeps glancing at the bell. Same lesson `usePrimedLists` backdates for.
  useEffect(() => {
    if (open) return;
    const updatedAt = qc.getQueryState(["social", "siteNotifs", viewerId])?.dataUpdatedAt;
    qc.setQueryData<InfiniteData<SiteNotifPage>>(
      ["social", "siteNotifs", viewerId],
      (old) =>
        old && old.pages.length > 1
          ? { pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) }
          : undefined,
      { updatedAt },
    );
  }, [open, qc, viewerId]);

  const unread = items.filter((n) => !n.read).length;

  // When the panel opens, land on the tab that actually has news — in either
  // direction. The first version only ever nudged local→site, which created
  // its own mirror of the bug it fixed: once you had been switched to the
  // AniList tab, a later Karasu-only notification put a badge over a panel
  // that opened onto the wrong tab with nothing pointing at the right one.
  // Karasu's own rows win a tie, being the rows only this bell can show.
  //
  // Rising edge only: a manual tab choice while the panel is open is the
  // user's and stays theirs, and the count being zeroed by mark-seen must not
  // bounce the view around. The open also refetches the count when stale —
  // the freshness the old `enabled: open` gate provided.
  const wasOpen = useRef(false);
  useEffect(() => {
    const rising = open && !wasOpen.current;
    wasOpen.current = open;
    if (!rising || !anilist) return;
    void qc.invalidateQueries({ queryKey: ["social", "notifCount", viewerId] });
    if (items.some((n) => !n.read)) {
      setView("local");
    } else if ((count.data ?? 0) > 0) {
      setView("site");
    }
  }, [open, anilist, items, count.data, qc, viewerId]);

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

  const siteRows = (site.data?.pages ?? []).flatMap((p) => p.rows);
  const siteUnread = anilist ? (count.data ?? 0) : 0;

  // Both sides of the story on one badge: Karasu's own unread rows plus
  // AniList's server-side count. Either alone lied by omission — the reported
  // case was twelve AniList notifications behind a silent bell.
  const badge = unread + siteUnread;

  // `view` is plain state nothing resets on sign-out, and the Segmented — its
  // only writer — hides outside anilist mode. Rendering from the raw state
  // would strand a signed-out bell on a site view it can neither fetch nor
  // leave, so the branch is taken on this instead.
  const shownView = anilist ? view : "local";

  const openRow = (row: SiteNotifRow) => {
    if (!row.target) return;
    setOpen(false);
    navigate(row.target);
  };

  // The local twin of `openRow`, and deliberately not the same shape: an
  // AniList row with no target is `disabled`, because marking read is
  // AniList's own job and a dead row has nothing left to do. A Karasu row
  // always has something to do — mark itself read — so it stays enabled and
  // the navigation is the extra. Rows written before schema v15 carry no media
  // id and simply stop there, which is exactly what every row did until now.
  const openLocal = async (n: AppNotification) => {
    await readOne(n);
    if (n.mediaId == null) return;
    setOpen(false);
    navigate(`/media/${n.mediaId}`);
  };

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-9 w-11 place-items-center text-ink-500 transition-surface hover:bg-surface-850 hover:text-ink-100"
        aria-label={t("notif.title")}
        title={t("notif.title")}
      >
        <BellIcon className="size-3.75" />
        {badge > 0 && (
          // The `s950` ring is what separates the badge from the bell glyph
          // beneath it — without it the two silhouettes merge at this size.
          // Breathes while there is something unread. The count is small and
          // sits in the corner of a quiet titlebar, so a badge that merely
          // appears is easy to walk past; this stops the moment it is read.
          <span className="animate-idle-pulse absolute right-1.5 top-1.5 grid h-3.25 min-w-3.25 place-items-center rounded-[.4375rem] border border-surface-950 bg-accent-500 px-1 text-[.5625rem] font-semibold text-accent-ink">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      {panel.mounted && (
        <div
          // The `data-overlay` convention: this panel is over the page and owns
          // the keyboard while it is, so a `j` or a `/` behind it does not move
          // a list selection nobody can see. Kept through the exit animation,
          // like every other overlay.
          data-overlay
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
              {shownView === "local" && unread > 0 && (
                <span className="text-2xs tabular-nums text-ink-500">{unread}</span>
              )}
            </span>
            {shownView === "local" && unread > 0 && (
              <button
                onClick={readAll}
                className="text-xs text-accent-400 hover:underline"
              >
                {t("notif.markAll")}
              </button>
            )}
          </div>

          {anilist && (
            <div className="border-b border-hair px-3 py-2">
              <Segmented
                aria-label={t("notif.title")}
                value={view}
                onChange={setView}
                segments={[
                  { value: "local", label: t("notif.tabKarasu") },
                  {
                    value: "site",
                    label: (
                      <span className="flex items-center gap-1.5">
                        {t("notif.tabAniList")}
                        {siteUnread > 0 && (
                          <span className="grid h-3.5 min-w-3.5 place-items-center rounded-[.4375rem] bg-accent-500 px-1 text-[.5625rem] font-semibold tabular-nums text-accent-ink">
                            {siteUnread > 99 ? "99+" : siteUnread}
                          </span>
                        )}
                      </span>
                    ),
                    title: t("notif.tabAniList"),
                  },
                ]}
              />
            </div>
          )}

          {shownView === "local" ? (
            loadError ? (
              <p className="px-3 py-6 text-center text-sm text-danger">
                {t("common.error", { message: loadError })}
              </p>
            ) : items.length === 0 ? (
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
                                onClick={() => openLocal(n)}
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
                                {/* Two rows that look identical must not behave
                                    differently. An app-update or dropped-queue
                                    row, and anything written before v15, has
                                    nowhere to go and says so by omitting this. */}
                                {n.mediaId != null && (
                                  <ChevronRight
                                    aria-hidden
                                    className="mt-1 size-3 shrink-0 self-start text-ink-600"
                                  />
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ),
                )}
              </div>
            )
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {site.isLoading && (
                <div className="space-y-2 p-3">
                  <Shimmer className="h-10 w-full rounded-lg" />
                  <Shimmer className="h-10 w-full rounded-lg" />
                </div>
              )}
              {site.error != null && (
                <p className="px-3 py-4 text-xs text-danger">
                  {t("common.error", { message: String(site.error) })}
                </p>
              )}
              {site.data && siteRows.length === 0 && (
                <EmptyState visual={<TickMarks />} title={t("notif.siteEmpty")} className="py-6" />
              )}
              {siteRows.length > 0 && (
                <ul>
                  {siteRows.map((row) => {
                    const Icon = SITE_ICON[row.kind];
                    return (
                      <li key={row.id}>
                        <button
                          onClick={() => openRow(row)}
                          disabled={!row.target}
                          className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-surface hover:bg-surface-850 disabled:hover:bg-transparent"
                        >
                          <span
                            className={cn(
                              "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md",
                              SITE_TINT[row.kind],
                            )}
                          >
                            <Icon className="size-3.25" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[.8125rem] font-medium text-ink-100">
                              {row.title}
                            </span>
                            <span className="mt-0.5 block text-xs text-ink-500">
                              {siteVerb(row, t)}
                            </span>
                            {row.detail && (
                              <span className="mt-0.5 block truncate text-2xs text-ink-600">
                                {row.detail}
                              </span>
                            )}
                            <span className="mt-0.5 block text-2xs text-ink-600">
                              {relTimeFromSeconds(row.createdAt, i18n.language, t("notif.now"))}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {site.hasNextPage && (
                <div className="border-t border-hair p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => site.fetchNextPage()}
                    disabled={site.isFetchingNextPage}
                    className="w-full"
                  >
                    {t("social.loadMorePlain")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
