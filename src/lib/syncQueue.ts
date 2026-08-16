/**
 * What the sync panel says, decided away from the component that draws it.
 *
 * Two things live here because getting either wrong is invisible on screen: the
 * precedence between the states a sync can be in, and the id-space trap in
 * naming what a queued row is about.
 */

import type { QueuedEdit, SyncStatus } from "@/api/types";

/**
 * The one-line answer to "is my data safe?".
 *
 * Ordered by what a user needs to know first. `draining` outranks `throttled`
 * because a drain that is briefly parked is still a drain in progress, and
 * `throttled` outranks `waiting` because a queue that is not moving *for a
 * reason* is a different thing from one merely waiting its turn.
 *
 * `offline` is first and separate on purpose: local mode issues no request ever,
 * so its empty queue is not the same statement as a signed-in account with
 * nothing pending. Collapsing the two would let the panel say "everything is
 * synced" about a list that syncs with nothing.
 */
export type SyncPhase = "offline" | "draining" | "throttled" | "waiting" | "idle";

export function syncPhase(status: SyncStatus): SyncPhase {
  if (!status.connected) return "offline";
  if (status.draining) return "draining";
  if (status.rate.throttledForMs != null) return "throttled";
  if (status.queued.length > 0) return "waiting";
  return "idle";
}

/** An entry as the panel needs it: both ids, so neither is guessed at. */
export interface QueueSubject {
  /** The list-entry id — what a `delete` names. */
  id: number;
  /** The media id — what a `save` names. */
  mediaId: number;
}

/**
 * The media a queued row is about, or null when it cannot be said.
 *
 * **A save's subject is a media id and a delete's is a list-entry id, and the
 * two number spaces overlap freely.** A lookup that tried both fields would not
 * fail on a collision — it would confidently label the row with somebody else's
 * title, which is worse than the blank it is trying to avoid. So each kind reads
 * exactly one field, and an unknown kind reads neither.
 *
 * Returning null rather than dropping the row is deliberate: the panel's count
 * has to agree with the pending badge, which is a plain `COUNT(*)`.
 */
export function queuedMediaId<T extends QueueSubject>(
  edit: Pick<QueuedEdit, "kind" | "subject">,
  entries: readonly T[],
): number | null {
  if (edit.subject == null) return null;
  if (edit.kind === "save") return edit.subject;
  if (edit.kind === "delete")
    return entries.find((e) => e.id === edit.subject)?.mediaId ?? null;
  return null;
}

/**
 * The fields a row's summary line can name, as a closed union.
 *
 * The strings come from AniList's own mutation arguments, so the set is fixed by
 * the schema rather than by us. A component maps these through a literal
 * `switch` to `t("…")` calls — an assembled key would be invisible to
 * `i18nKeys.test.ts`, and anything outside the union falls back to the raw name
 * rather than to an empty cell.
 */
export const QUEUE_FIELDS = [
  "status",
  "progress",
  "progressVolumes",
  "scoreRaw",
  "advancedScores",
  "repeat",
  "notes",
  "private",
  "hiddenFromStatusLists",
  "customLists",
  "startedAt",
  "completedAt",
] as const;

export type QueueField = (typeof QUEUE_FIELDS)[number];

export function isQueueField(field: string): field is QueueField {
  return (QUEUE_FIELDS as readonly string[]).includes(field);
}
