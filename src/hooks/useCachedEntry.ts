import { useQuery } from "@tanstack/react-query";
import { fetchMediaList, isTauri } from "@/api/anilist";
import { useAuth } from "@/stores/auth";
import type { MediaListEntry, MediaType } from "@/api/types";

/**
 * The user's list entry for one media.
 *
 * **In AniList mode** this subscribes to the cache the list screens already
 * fill and never fetches — `enabled: false`, the same reason `useListSummary`
 * has it. It is still a real observer, so an optimistic save re-renders
 * whatever is showing the entry, which `getQueryData` would not.
 *
 * **In local mode it fetches**, and that is the whole point of this hook now.
 * The account-free profile's list lives in SQLite and AniList has never heard
 * of it, so `anilist_query` sends no token and `mediaListEntry` comes back
 * `null` for *every* title — including ones the user is actively tracking.
 * Anything seeding an editor from that null wrote `PLANNING / 0 / 0 / 0 / ""`
 * over a real entry the moment the user pressed Save, because `local_save_entry`
 * COALESCEs only *absent* values and those seams sent every scalar.
 *
 * The fetch is safe to enable here for a reason worth stating: `fetchMediaList`
 * routes to `local_fetch_list` in local mode, which is a SQLite read over IPC
 * and spends **nothing** from the ~30/min AniList budget. It also shares the
 * exact key the list screens use (`["mediaList", type, 0]`), so it is usually
 * already warm and this costs one cache hit.
 *
 * Returns `undefined` while the list has not loaded and `null` once it has
 * without finding the title, so a caller that would otherwise assert "not on
 * your list" can wait instead of guessing.
 */
export function useCachedEntry(
  userId: number | undefined,
  type: MediaType | undefined,
  mediaId: number | undefined,
): MediaListEntry | null | undefined {
  const local = useAuth((s) => s.mode) === "local";
  const { data } = useQuery({
    queryKey: ["mediaList", type, userId],
    queryFn: () => fetchMediaList(userId as number, type as MediaType),
    enabled: local && isTauri && type !== undefined,
  });
  if (!mediaId) return undefined;
  // `undefined` = the list has not loaded; `null` = it has, and this title is
  // not on it. Callers that would otherwise state "not on your list" before
  // knowing need that distinction — everyone else can keep treating both as
  // falsy, which is what the two Franchise call sites already do.
  if (!data) return undefined;
  return data.lists.flatMap((g) => g.entries).find((e) => e.mediaId === mediaId) ?? null;
}
