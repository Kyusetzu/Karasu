/** The stable code `commands/prefs.rs` rejects with when the interval was saved but JobScheduler refused to mirror it. */
export const NOTIF_JOB_REFUSED = "settings.notifJobRefused";

export type NotifScheduleFailure = {
  kind: "refused" | "failed";
  /** The platform's reason, or the raw rejection; empty when there is none. */
  detail: string;
};

/** A closed kind for the pane's literal `t()` calls: `refused` means the setting is saved, `failed` means it is not. */
export function notifScheduleFailure(text: string): NotifScheduleFailure {
  const trimmed = text.trim();
  if (trimmed === NOTIF_JOB_REFUSED || trimmed.startsWith(`${NOTIF_JOB_REFUSED}:`)) {
    return {
      kind: "refused",
      detail: trimmed.slice(NOTIF_JOB_REFUSED.length).replace(/^:\s*/, ""),
    };
  }
  return { kind: "failed", detail: trimmed };
}
