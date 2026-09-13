import type { Viewer } from "@/api/types";

/** Whether AniList raises its own AIRING notice; keep it in step with `anilist_covers_airing` in `alerts/airing.rs`. */
export function anilistCoversAiring(viewer: Viewer | null | undefined): boolean {
  const options = viewer?.options;
  // Anything unknown is false: a duplicate bell row costs less than a notice the user never sees.
  if (!options) return false;
  if (options.airingNotifications !== true) return false;

  const list = options.notificationOptions;
  if (!list) return true;
  const airing = list.find((o) => o.type === "AIRING");
  // Absent entry — never stored for this account — is on.
  return airing ? airing.enabled === true : true;
}
