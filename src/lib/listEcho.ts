import type { ListEntryStub } from "@/api/queries";

/** A save's echo as the detail page's entry, or null when it does not say which status the entry is now in. */
export function entryFromEcho(echo: unknown): ListEntryStub | null {
  if (!echo || typeof echo !== "object") return null;
  const e = echo as Partial<ListEntryStub>;
  // Local mode echoes only the ids and a timestamp; taken as the entry, the page would name a status it does not have.
  if (typeof e.id !== "number" || typeof e.status !== "string") return null;
  return {
    id: e.id,
    status: e.status,
    progress: e.progress ?? 0,
    score: e.score ?? 0,
    repeat: e.repeat ?? 0,
    notes: e.notes ?? null,
  };
}
