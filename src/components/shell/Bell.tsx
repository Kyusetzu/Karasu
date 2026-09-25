import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
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
  ChevronDown,
  ChevronRight,
  Clock,
  Film,
  Heart,
  MessageCircle,
  UserPlus,
} from "lucide-react";
import { EmptyState, TickMarks } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/Skeleton";
import { cn } from "@/lib/utils";
import { relTime } from "@/lib/relTime";
import { usePresence } from "@/hooks/usePresence";
import { useBackClose } from "@/hooks/useBackClose";
import { useNotifBadge } from "@/hooks/useNotifBadge";
import { useAuth } from "@/stores/auth";
import { isAndroid, usePlatform } from "@/stores/platform";
import {
  getNotifications,
  isTauri,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
  apkInstall,
  apkUpdateState,
  downloadPendingUpdate,
  installPendingUpdate,
} from "@/api/anilist";
import { showToast } from "@/stores/toast";
import { isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { siteNotifications, siteNotifCount, type SiteNotifPage } from "@/api/social";
import type { SiteNotifKind, SiteNotifRow } from "@/lib/siteNotifications";
import {
  buildGroups,
  unify,
  type GroupLabel,
  type NotifGroup,
  type UnifiedNotif,
} from "@/lib/notifGroups";

const KIND_ICON: Record<string, typeof BellIcon> = {
  airing: CalendarClock,
  stale: Clock,
  sequel: Film,
};

/** Each kind of notice gets its own tint, because an episode, a stale entry and a sequel are not the same news. */
const KIND_TINT: Record<string, string> = {
  airing: "bg-accent-500/14 text-accent-400",
  stale: "bg-surface-800 text-ink-500",
  sequel: "bg-success/14 text-success",
};
const DEFAULT_TINT = "bg-surface-800 text-ink-500";

/** The site rows reuse the same vocabulary, grouped by what the news is rather than by API type. */
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

/** Literal `t()` per case so `i18nKeys.test.ts` sees every key; AniList's English-only `context` is never rendered. */
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

/** The grouped row's verb — the same literal-`t()` shape as `siteVerb`. */
function groupVerb(
  label: GroupLabel,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  switch (label.kind) {
    case "likes":
      return t("notif.groupLikes", { n: label.n });
    case "replyLikes":
      return t("notif.groupReplyLikes", { n: label.n });
    case "replies":
      return t("notif.groupReplies", { n: label.n });
    case "airing":
      return t("notif.groupAiring", { n: label.n });
  }
}

export default function Bell({ barSlot = false }: { barSlot?: boolean }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const android = isAndroid(usePlatform((s) => s.info));
  const mode = useAuth((s) => s.mode);
  // Part of both AniList query keys, or a sign-out and sign-in within a staleTime shows the old account's badge.
  const viewerId = useAuth((s) => s.viewer?.id ?? null);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));
  const panel = usePresence(open);
  const ref = useRef<HTMLDivElement>(null);
  // Which grouped rows are unfolded; reset on every open so a fresh glance starts collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // How many site rows wear the unread dot: a snapshot taken at open, before the page-1 fetch resets the count.
  const [siteUnseen, setSiteUnseen] = useState(0);

  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!isTauri) return;
    // Report the failure; a swallowed one renders the empty state, which reads as all caught up.
    getNotifications()
      .then((rows) => {
        setItems(rows);
        setLoadError(null);
      })
      .catch((e) => setLoadError(String(e)));
  }, []);

  // Keep the guard; outside Tauri `listen` throws during mount and the ErrorBoundary blanks the whole window.
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

  // Feeds the always-visible badge; keep the interval, or staleTime freezes it since nothing else touches this key.
  const count = useQuery({
    queryKey: ["social", "notifCount", viewerId],
    queryFn: siteNotifCount,
    enabled: isTauri && anilist,
    staleTime: 60_000,
    refetchInterval: 10 * 60_000,
  });

  // Page 1's `reset` is AniList's mark-seen, so the count is zeroed here; cancel first or a stale in-flight read wins.
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
    enabled: isTauri && open && anilist,
    staleTime: 60_000,
  });

  // Trim retained pages on close so a stale reopen refetches one page; keep `updatedAt` or the trim postpones it.
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

  // On the rising edge of open: snapshot the unseen count before page 1 zeroes it, collapse, refetch the count.
  const wasOpen = useRef(false);
  useEffect(() => {
    const rising = open && !wasOpen.current;
    wasOpen.current = open;
    if (!rising) return;
    setExpanded(new Set());
    if (!anilist) return;
    setSiteUnseen(count.data ?? 0);
    void qc.invalidateQueries({ queryKey: ["social", "notifCount", viewerId] });
  }, [open, anilist, count.data, qc, viewerId]);

  const readOne = async (n: AppNotification) => {
    if (n.read) return;
    await markNotificationRead(n.id).catch(() => {});
    load();
  };

  const readAll = async () => {
    // Always offered, so a badge the panel cannot explain still has a way out; an empty press says so.
    if (unread + siteUnseen === 0) {
      showToast({ kind: "info", text: t("notif.nothingToMark") });
      return;
    }
    await markAllNotificationsRead().catch(() => {});
    // The AniList half was already marked seen server-side by the page-1 reset; what remains is the dots.
    setSiteUnseen(0);
    load();
  };

  // The one number on the bell, computed once and shared with the phone shell's More button by query key.
  const badge = useNotifBadge();

  // Filtered once before grouping: a row about a blocked title is dropped, since the row itself names the title.
  const level = useContentFilter((s) => s.level);
  const siteRows = useMemo(
    () =>
      (site.data?.pages ?? [])
        .flatMap((p) => p.rows)
        .filter((r) => !isBlocked(r.media, level)),
    [site.data, level],
  );

  // One stream, grouped in presentation only: recomputed over the loaded set, so a group may grow as older pages land.
  const groups = useMemo(
    () => buildGroups(unify(items, anilist ? siteRows : [], siteUnseen)),
    [items, anilist, siteRows, siteUnseen],
  );

  if (!isTauri) return null;

  const openSite = (row: SiteNotifRow) => {
    if (!row.target) return;
    setOpen(false);
    navigate(row.target);
  };

  // Local twin of `openSite`, never disabled: a Karasu row can always mark itself read, and navigation is the extra.
  const openLocal = async (n: AppNotification) => {
    await readOne(n);
    // Tapping an update row installs it; `download` first, because a restart empties the in-memory pending update.
    if (n.kind === "update") {
      setOpen(false);
      // Android: a verified APK opens the installer right here; anything short of that is About's to explain.
      if (android) {
        const state = await apkUpdateState().catch(() => null);
        if (state?.status === "ready" && !state.needsInstallPermission) {
          await apkInstall().catch((e) => showToast({ kind: "error", text: t("common.error", { message: String(e) }) }));
          return;
        }
        navigate("/about");
        return;
      }
      try {
        await downloadPendingUpdate();
        await installPendingUpdate();
      } catch (e) {
        showToast({ kind: "error", text: t("common.error", { message: String(e) }) });
      }
      return;
    }
    if (n.mediaId == null) return;
    setOpen(false);
    navigate(`/media/${n.mediaId}`);
  };

  // An airing group has one destination, so it goes there; an actor group's members differ, so it unfolds.
  const openGroup = (g: NotifGroup) => {
    if (g.label?.kind === "airing") {
      for (const m of g.items) if (m.local) void readOne(m.local);
      const mediaId = g.items.find((m) => m.mediaId != null)?.mediaId;
      if (mediaId != null) {
        setOpen(false);
        navigate(`/media/${mediaId}`);
      }
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(g.key)) next.delete(g.key);
      else next.add(g.key);
      return next;
    });
  };

  const rowTime = (atMs: number) => relTime(atMs, i18n.language, t("notif.now"));

  const renderLocal = (n: AppNotification) => {
    const Icon = KIND_ICON[n.kind] ?? BellIcon;
    return (
      <button
        onClick={() => void openLocal(n)}
        className={cn(
          "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-surface hover:bg-surface-850",
          !n.read && "bg-[rgba(255,255,255,.018)]",
        )}
      >
        <span
          className={cn(
            "mt-0.5 grid size-6 shrink-0 place-items-center rounded-inner",
            KIND_TINT[n.kind] ?? DEFAULT_TINT,
          )}
        >
          <Icon className="size-3.25" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-ui font-medium text-ink-100">
              {n.title}
            </span>
            {!n.read && <span className="size-1.5 shrink-0 rounded-full bg-accent-500" />}
          </span>
          <span className="mt-0.5 block text-xs text-ink-500">{n.body}</span>
          <span className="mt-0.5 block text-2xs text-ink-600">{rowTime(n.createdMs)}</span>
        </span>
        {/* Two rows that look identical must not behave differently: a row with nowhere to go omits the chevron. */}
        {n.mediaId != null && (
          <ChevronRight aria-hidden className="mt-1 size-3 shrink-0 self-start text-ink-600" />
        )}
      </button>
    );
  };

  // The actor's own page, for rows whose press goes to the activity; the name is then the profile's only door.
  const profileOf = (row: SiteNotifRow): string | null =>
    row.activityId != null && row.actorName
      ? `/user/${encodeURIComponent(row.actorName)}`
      : null;

  const renderSite = (row: SiteNotifRow, isUnread: boolean) => {
    const Icon = SITE_ICON[row.kind];
    const profile = profileOf(row);
    const body = (
      <>
        <span
          className={cn(
            "mt-0.5 grid size-6 shrink-0 place-items-center rounded-inner",
            SITE_TINT[row.kind],
          )}
        >
          <Icon className="size-3.25" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            {profile ? (
              // Nested link, so the container below is a div-button: a real <button> cannot legally hold a link.
              <Link
                to={profile}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                }}
                className="truncate text-ui font-medium text-ink-100 hover:underline"
              >
                {row.title}
              </Link>
            ) : (
              <span className="truncate text-ui font-medium text-ink-100">
                {row.title}
              </span>
            )}
            {isUnread && <span className="size-1.5 shrink-0 rounded-full bg-accent-500" />}
          </span>
          <span className="mt-0.5 block text-xs text-ink-500">{siteVerb(row, t)}</span>
          {row.detail && (
            <span className="mt-0.5 block truncate text-2xs text-ink-600">{row.detail}</span>
          )}
          <span className="mt-0.5 block text-2xs text-ink-600">
            {rowTime(row.createdAt * 1000)}
          </span>
        </span>
      </>
    );
    const rowClass = cn(
      "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-surface hover:bg-surface-850",
      isUnread && "bg-[rgba(255,255,255,.018)]",
    );
    if (profile) {
      return (
        <div
          role="button"
          tabIndex={0}
          onClick={() => openSite(row)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openSite(row);
            }
          }}
          className={cn(rowClass, "cursor-pointer")}
        >
          {body}
        </div>
      );
    }
    return (
      <button
        onClick={() => openSite(row)}
        disabled={!row.target}
        className={cn(rowClass, "disabled:hover:bg-transparent")}
      >
        {body}
      </button>
    );
  };

  const renderItem = (n: UnifiedNotif) =>
    n.local ? renderLocal(n.local) : n.site ? renderSite(n.site, n.unread) : null;

  const renderGroup = (g: NotifGroup) => {
    const label = g.label!;
    const isOpen = expanded.has(g.key);
    const lead = label.kind === "airing" ? label.title : label.name;
    // An actor group's press unfolds it, so the name carries the profile, making the container a div-button.
    const leadProfile =
      label.kind !== "airing" && g.items[0]?.site?.actorName
        ? `/user/${encodeURIComponent(g.items[0].site.actorName)}`
        : null;
    const Icon =
      label.kind === "airing" ? CalendarClock : label.kind === "replies" ? MessageCircle : Heart;
    const tint =
      label.kind === "airing"
        ? "bg-accent-500/14 text-accent-400"
        : label.kind === "replies"
          ? "bg-surface-800 text-ink-500"
          : "bg-danger/14 text-danger";
    return (
      <li key={g.key}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => openGroup(g)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openGroup(g);
            }
          }}
          aria-expanded={label.kind === "airing" ? undefined : isOpen}
          className={cn(
            "flex w-full cursor-pointer items-start gap-2.5 px-3 py-2.5 text-left transition-surface hover:bg-surface-850",
            g.unread && "bg-[rgba(255,255,255,.018)]",
          )}
        >
          <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-inner", tint)}>
            <Icon className="size-3.25" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              {leadProfile ? (
                <Link
                  to={leadProfile}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                  }}
                  className="truncate text-ui font-medium text-ink-100 hover:underline"
                >
                  {lead}
                </Link>
              ) : (
                <span className="truncate text-ui font-medium text-ink-100">{lead}</span>
              )}
              <span className="rounded bg-surface-800 px-1 text-2xs tabular-nums text-ink-300">
                {label.n}
              </span>
              {g.unread && <span className="size-1.5 shrink-0 rounded-full bg-accent-500" />}
            </span>
            <span className="mt-0.5 block text-xs text-ink-500">{groupVerb(label, t)}</span>
            <span className="mt-0.5 block text-2xs text-ink-600">{rowTime(g.atMs)}</span>
          </span>
          {label.kind === "airing" ? (
            <ChevronRight aria-hidden className="mt-1 size-3 shrink-0 self-start text-ink-600" />
          ) : (
            <ChevronDown
              aria-hidden
              className={cn(
                "mt-1 size-3 shrink-0 self-start text-ink-600 transition-transform",
                isOpen && "rotate-180",
              )}
            />
          )}
        </div>
        {isOpen && (
          <ul className="border-l border-surface-800 pl-2 ml-5.5">
            {g.items.map((m) => (
              <li key={m.key}>{renderItem(m)}</li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div ref={ref} className="relative flex items-center">
      <button
        onClick={() => setOpen((v) => !v)}
        // On the phone shell this button is a bottom-bar slot, so it wears the bar's proportions there.
        className={cn(
          "relative transition-surface",
          barSlot
            ? "flex h-full min-w-11 flex-col items-center justify-center rounded-control px-2 text-ink-500 hover:text-ink-100"
            : "grid h-9 w-11 place-items-center text-ink-500 hover:bg-surface-850 hover:text-ink-100",
        )}
        aria-label={t("notif.title")}
        title={t("notif.title")}
      >
        <BellIcon className={barSlot ? "size-5" : "size-3.75"} />
        {badge > 0 && (
          // Keep the `s950` ring, or the badge and bell glyph merge at this size; the pulse stops once read.
          <span className="animate-idle-pulse absolute right-1.5 top-1.5 grid h-3.25 min-w-3.25 place-items-center rounded-[.4375rem] border border-surface-950 bg-accent-500 px-1 text-[.5625rem] font-semibold text-accent-ink">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      {panel.mounted && (
        <div
          // `data-overlay`: the panel owns the keyboard while it is over the page, and keeps it through the exit animation.
          data-overlay
          className={cn(
            // Under the titlebar bell on desktop; a sheet above the phone shell's bottom bar, `fixed` to escape the bar's box.
            barSlot
              ? "fixed inset-x-2 bottom-[calc(var(--shell-bottom,0px)+0.5rem)] z-50 origin-bottom overflow-hidden rounded-panel border border-hair bg-surface-900 shadow-float panel-wash"
              : "absolute right-0 top-full z-50 mt-1 w-88 origin-top-right overflow-hidden rounded-panel border border-hair bg-surface-900 shadow-float panel-wash",
            panel.leaving ? "animate-pop-out" : "animate-spring-in",
          )}
        >
          <div className="flex items-center justify-between border-b border-hair px-3 py-2">
            <span className="flex items-baseline gap-2">
              <span className="text-2xs font-semibold uppercase tracking-[.14em] text-ink-600">
                {t("notif.title")}
              </span>
              {unread + siteUnseen > 0 && (
                <span className="text-2xs tabular-nums text-ink-500">
                  {unread + siteUnseen}
                </span>
              )}
            </span>
            {/* Both sides clear here, and the button never hides: a stale badge needs it most. */}
            <button onClick={readAll} className="text-xs text-accent-400 hover:underline">
              {t("notif.markAll")}
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loadError && (
              <p className="px-3 py-4 text-center text-sm text-danger">
                {t("common.error", { message: loadError })}
              </p>
            )}
            {site.error != null && (
              <p className="px-3 py-4 text-xs text-danger">
                {t("common.error", { message: String(site.error) })}
              </p>
            )}
            {anilist && site.isLoading && groups.length === 0 && (
              <div className="space-y-2 p-3">
                <Shimmer className="h-10 w-full rounded-control" />
                <Shimmer className="h-10 w-full rounded-control" />
              </div>
            )}
            {!loadError && !site.isLoading && groups.length === 0 && (
              <EmptyState visual={<TickMarks />} title={t("notif.empty")} className="py-6" />
            )}
            {groups.length > 0 && (
              <ul>
                {groups.map((g) =>
                  g.label ? renderGroup(g) : <li key={g.key}>{renderItem(g.items[0])}</li>,
                )}
              </ul>
            )}
            {anilist && site.hasNextPage && (
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
        </div>
      )}
    </div>
  );
}
