import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import {
  apkInstall,
  apkUpdateState,
  downloadPendingUpdate,
  getNotifications,
  installPendingUpdate,
  isTauri,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "@/api/anilist";
import { siteNotifications, type SiteNotifPage } from "@/api/social";
import { buildGroups, unify, type NotifGroup, type NotifSource } from "@/lib/notifGroups";
import type { SiteNotifRow } from "@/lib/siteNotifications";
import { isBlocked } from "@/lib/contentFilter";
import { useAuth } from "@/stores/auth";
import { useContentFilter } from "@/stores/contentFilter";
import { isAndroid, usePlatform } from "@/stores/platform";
import { showToast } from "@/stores/toast";

/** How a surface steps aside before a row navigates: the dropdown and the sheet close first, the page just goes. */
export type Leave = (go: () => void) => void;

/** A page of AniList's rows; the first also carries how many of its rows were new when it spent AniList's count. */
type SitePage = SiteNotifPage & { unseen: number };

/** Surfaces showing the stream right now; the loaded pages are trimmed only when the last of them goes. */
let activeSurfaces = 0;

/** The bell's one stream, for whichever surface shows it; `active` is that surface being open or mounted. */
export function useNotifications({ active, source = "all" }: { active: boolean; source?: NotifSource }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const android = isAndroid(usePlatform((s) => s.info));
  const mode = useAuth((s) => s.mode);
  // Part of both AniList query keys, or a sign-out and sign-in within a staleTime shows the old account's badge.
  const viewerId = useAuth((s) => s.viewer?.id ?? null);
  const anilist = mode === "anilist";
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Which grouped rows are unfolded; reset on every open so a fresh glance starts collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const countKey = useMemo(() => ["social", "notifCount", viewerId], [viewerId]);
  const siteKey = useMemo(() => ["social", "siteNotifs", viewerId], [viewerId]);

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

  // Page 1's `reset` is AniList's mark-seen, so the count it spends is kept on the page, where every surface reads it.
  const site = useInfiniteQuery({
    queryKey: siteKey,
    queryFn: async ({ pageParam }): Promise<SitePage> => {
      const reset = pageParam === 1;
      const unseen = reset ? (qc.getQueryData<number>(countKey) ?? 0) : 0;
      const page = await siteNotifications(pageParam, reset);
      if (reset) {
        // Cancel first, or a stale in-flight read of the count lands after the zero.
        await qc.cancelQueries({ queryKey: countKey });
        qc.setQueryData(countKey, 0);
      }
      return { ...page, unseen };
    },
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.pageInfo.hasNextPage ? all.length + 1 : undefined),
    enabled: isTauri && active && anilist,
    staleTime: 60_000,
    // More than one page means another surface is reading them, and a refetch here would re-request every one.
    refetchOnMount: (query) => (query.state.data?.pages.length ?? 0) <= 1,
  });

  // Trim retained pages once the last surface goes, so a reopen fetches one page; keep `updatedAt` or the trim postpones it.
  useEffect(() => {
    if (!active) return;
    activeSurfaces += 1;
    return () => {
      activeSurfaces -= 1;
      if (activeSurfaces > 0) return;
      const updatedAt = qc.getQueryState(siteKey)?.dataUpdatedAt;
      qc.setQueryData<InfiniteData<SitePage>>(
        siteKey,
        (old) =>
          old && old.pages.length > 1
            ? { pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) }
            : undefined,
        { updatedAt },
      );
    };
  }, [active, qc, siteKey]);

  // A fresh glance starts collapsed.
  const wasActive = useRef(false);
  useEffect(() => {
    const rising = active && !wasActive.current;
    wasActive.current = active;
    if (rising) setExpanded(new Set());
  }, [active]);

  const siteUnseen = anilist ? (site.data?.pages[0]?.unseen ?? 0) : 0;
  const unread = items.filter((n) => !n.read).length + siteUnseen;

  const readOne = async (n: AppNotification) => {
    if (n.read) return;
    await markNotificationRead(n.id).catch(() => {});
    load();
  };

  const readAll = async () => {
    // Always offered, so a badge the panel cannot explain still has a way out; an empty press says so.
    if (unread === 0) {
      showToast({ kind: "info", text: t("notif.nothingToMark") });
      return;
    }
    await markAllNotificationsRead().catch(() => {});
    // The AniList half was already marked seen server-side by the page-1 reset; what remains is the dots.
    qc.setQueryData<InfiniteData<SitePage>>(siteKey, (old) =>
      old ? { ...old, pages: old.pages.map((p, i) => (i === 0 ? { ...p, unseen: 0 } : p)) } : old,
    );
    load();
  };

  // Filtered once before grouping: a row about a blocked title is dropped, since the row itself names the title.
  const level = useContentFilter((s) => s.level);
  const siteRows = useMemo(
    () => (site.data?.pages ?? []).flatMap((p) => p.rows).filter((r) => !isBlocked(r.media, level)),
    [site.data, level],
  );

  // One stream, grouped in presentation only: recomputed over the loaded set, so a group may grow as older pages land.
  const groups = useMemo(
    () =>
      buildGroups(
        unify(
          source === "anilist" ? [] : items,
          anilist && source !== "karasu" ? siteRows : [],
          siteUnseen,
        ),
      ),
    [items, anilist, siteRows, siteUnseen, source],
  );

  const openSite = (row: SiteNotifRow, leave: Leave) => {
    const target = row.target;
    if (!target) return;
    leave(() => navigate(target));
  };

  // Tapping an update row installs it; `download` first, because a restart empties the in-memory pending update.
  const runUpdate = async () => {
    // Android: a verified APK opens the installer right here; anything short of that is About's to explain.
    if (android) {
      const state = await apkUpdateState().catch(() => null);
      if (state?.status === "ready" && !state.needsInstallPermission) {
        await apkInstall().catch((e) => showToast({ kind: "error", text: t("common.error", { message: String(e) }) }));
      } else {
        navigate("/about");
      }
      return;
    }
    try {
      await downloadPendingUpdate();
      await installPendingUpdate();
    } catch (e) {
      showToast({ kind: "error", text: t("common.error", { message: String(e) }) });
    }
  };

  // Local twin of `openSite`, never disabled: a Karasu row can always mark itself read, and navigation is the extra.
  const openLocal = (n: AppNotification, leave: Leave) => {
    // Leaves at once and marks read beside it, so a surface closed during the write cannot strand the navigation.
    void readOne(n);
    if (n.kind === "update") {
      leave(() => void runUpdate());
      return;
    }
    const mediaId = n.mediaId;
    if (mediaId == null) return;
    leave(() => navigate(`/media/${mediaId}`));
  };

  // An airing group has one destination, so it goes there; an actor group's members differ, so it unfolds.
  const openGroup = (g: NotifGroup, leave: Leave) => {
    if (g.label?.kind === "airing") {
      for (const m of g.items) if (m.local) void readOne(m.local);
      const mediaId = g.items.find((m) => m.mediaId != null)?.mediaId;
      if (mediaId != null) leave(() => navigate(`/media/${mediaId}`));
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(g.key)) next.delete(g.key);
      else next.add(g.key);
      return next;
    });
  };

  return {
    anilist,
    // Whether AniList's half is in view, which the filter can take away even when an account is signed in.
    showsSite: anilist && source !== "karasu",
    groups,
    unread,
    loadError,
    site,
    expanded,
    readAll,
    openLocal,
    openSite,
    openGroup,
  };
}

export type Notifications = ReturnType<typeof useNotifications>;
