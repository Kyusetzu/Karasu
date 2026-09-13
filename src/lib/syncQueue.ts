/** What the sync panel says, kept out of the component because a wrong precedence or subject is invisible on screen. */

import type { QueuedEdit, SyncStatus } from "@/api/types";

/** The sync states by precedence; keep `offline` separate from `idle`, or the panel calls a local list "synced". */
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

/** The media a queued row is about; a save's subject is a media id and a delete's an entry id, and the spaces overlap. */
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

/** AniList's mutation arguments as a closed union, mapped through a literal `switch` so `i18nKeys.test.ts` sees the keys. */
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
