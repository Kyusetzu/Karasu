/**
 * What a failed `set_notif_schedule` means, read off the string Rust rejected
 * with.
 *
 * On Android the command stores the interval first and then asks JobScheduler
 * to mirror it. A refusal there comes back under the stable code
 * `NOTIF_JOB_REFUSED` — spelled in `commands/prefs.rs`, pinned by the test —
 * with the platform's own reason after it, and means the setting *is* saved
 * and the job will be retried at the next start. Anything else is the write
 * itself failing, and the setting is not saved. The two need different
 * sentences, so this returns a closed kind for the pane to map through literal
 * `t("…")` calls (the shape `i18nKeys.test.ts` can see), and the reason as the
 * detail line rather than as the headline.
 */
export const NOTIF_JOB_REFUSED = "settings.notifJobRefused";

export type NotifScheduleFailure = {
  kind: "refused" | "failed";
  /** The platform's reason, or the raw rejection; empty when there is none. */
  detail: string;
};

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
