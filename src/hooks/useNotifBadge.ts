import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { getNotifications, isTauri } from "@/api/anilist";
import { siteNotifCount } from "@/api/social";
import { useAuth } from "@/stores/auth";

/**
 * How many notifications are waiting, both sides summed — for anything that
 * wants to wear the number without being the bell.
 *
 * The phone shell's More button is the customer: the bell lives inside its
 * sheet there, so the closed sheet needs the count on the outside. The site
 * half shares the exact query key the bell uses (viewer id included — the
 * cross-account lesson), so this adds observers to a cached query, never a
 * second request. The local half re-reads on the same `notifications-changed`
 * event the bell listens for.
 */
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
