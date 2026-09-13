import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { getNotifications, isTauri } from "@/api/anilist";
import { siteNotifCount } from "@/api/social";
import { useAuth } from "@/stores/auth";

/** Waiting notifications, both sides summed; the site half shares the bell's query key, so it never adds a request. */
export function useNotifBadge(): number {
  const mode = useAuth((s) => s.mode);
  const viewerId = useAuth((s) => s.viewer?.id ?? null);
  const anilist = mode === "anilist";
  const [localUnread, setLocalUnread] = useState(0);

  useEffect(() => {
    if (!isTauri) return;
    const load = () =>
      getNotifications()
        .then((rows) => setLocalUnread(rows.filter((n) => !n.read).length))
        .catch(() => {});
    load();
    const un = listen("notifications-changed", () => load());
    return () => {
      un.then((f) => f());
    };
  }, []);

  const count = useQuery({
    queryKey: ["social", "notifCount", viewerId],
    queryFn: siteNotifCount,
    enabled: isTauri && anilist,
    staleTime: 60_000,
    refetchInterval: 10 * 60_000,
  });

  return localUnread + (anilist ? (count.data ?? 0) : 0);
}
