import type { Viewer } from "@/api/types";

/**
 * Whether AniList will raise its own AIRING notification for this account.
 *
 * **This copy decides only what the Detection pane *says*.** The one that
 * decides what happens is `anilist_covers_airing` in `src-tauri/src/alerts/
 * airing.rs`, which runs in the background watcher where no WebView exists.
 * The rules are duplicated on purpose and must move together; the tests below
 * each file mirror one another case for case.
 *
 * Two switches govern this, and they are separate settings on separate AniList
 * pages: the account-wide `options.airingNotifications`, and the per-type
 * `notificationOptions[AIRING].enabled` from the twenty-checkbox grid. Which of
 * the two the server consults when it *creates* the notification is
 * undocumented, and cannot be settled without flipping a real account's
 * settings and waiting for an episode. So this asks for both.
 *
 * The asymmetry is the whole design. Being wrong towards "AniList has it" costs
 * the user a notice they never see; being wrong the other way costs a duplicate
 * bell row, which is merely the behaviour this replaced. So anything unknown is
 * `false`: no `options` block (a viewer cached before it was queried, or no
 * account), either switch off, either switch absent.
 *
 * The one thing read as on without being said so is an *entry* missing from
 * `notificationOptions`, or the array being absent — AniList's own default for
 * a type it has never stored, and the same default `mergeNotificationOptions`
 * applies.
 */
export function anilistCoversAiring(viewer: Viewer | null | undefined): boolean {
  const options = viewer?.options;
  if (!options) return false;
  if (options.airingNotifications !== true) return false;

  const list = options.notificationOptions;
  if (!list) return true;
  const airing = list.find((o) => o.type === "AIRING");
  // Absent entry — never stored for this account — is on.
  return airing ? airing.enabled === true : true;
}
