import type { MediaListGroup } from "@/api/types";

/**
 * The account's custom-list names, in the one name space that works.
 *
 * AniList has two, and they are not the same string. `MediaListCollection`'s
 * group `name` is a **display** value — it upper-cases the first character and
 * invents section names that exist nowhere else (an account with split-by-
 * format has a "Completed TV" group and no such list). The names that identify
 * a list are the raw ones: the keys of each entry's `customLists` map, and what
 * `SaveMediaListEntry(customLists:)` writes back.
 *
 * Karasu read the display name and looked it up in the raw map, which is a bug
 * with three faces for anyone whose list is not already capitalised:
 *
 * - the membership checkbox never rendered ticked, because
 *   `memberships.has("Backlog")` cannot match the key `"backlog"`;
 * - the custom-list filter returned nothing, because
 *   `entry.customLists["Backlog"]` is `undefined`;
 * - and ticking one then saving sent `customLists: ["Backlog"]` — a name the
 *   account does not have, which drops the entry from the list it *was* in.
 *
 * Every entry carries the full declared set with a boolean each, so the union
 * of the keys is the complete list and it costs no extra request. An account
 * with no entries yet reports none, which is the right answer: there is nothing
 * to file anywhere.
 */
export function customListNames(groups: MediaListGroup[]): string[] {
  const names = new Set<string>();
  for (const group of groups) {
    for (const entry of group.entries) {
      for (const name of Object.keys(entry.customLists ?? {})) names.add(name);
    }
  }
  // Sorted for a stable dropdown; the raw name is shown as the user typed it,
  // which is how it reads on their own account rather than how AniList's site
  // chooses to capitalise it.
  return [...names].sort((a, b) => a.localeCompare(b));
}
