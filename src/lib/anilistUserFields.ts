/**
 * AniList's own account settings: which ones Karasu overrides, and how to send
 * a change without destroying anything.
 *
 * Two hazards live in this API and both are quiet. They are the reason this file
 * is pure logic with tests rather than a form handler.
 *
 * **1. `animeListOptions` / `mangaListOptions` can delete custom lists, with no
 * undo on AniList's side.** `MediaListOptionsInput.customLists` is a full
 * replacement, so sending the object with a stale or absent list removes lists
 * the user built by hand. `formToUpdateUserVars` therefore never emits either
 * field, and a test asserts that — confirmed unnecessary by introspection:
 * `scoreFormat` and `rowOrder` are **top-level `UpdateUser` arguments**, while
 * `MediaListOptionsInput` contains only `sectionOrder`,
 * `splitCompletedSectionByFormat`, `customLists`, `advancedScoring`,
 * `advancedScoringEnabled` and `theme` — nothing this pane needs and everything
 * it could break.
 *
 * **2. `notificationOptions` is a whole-array write.** A partial send silently
 * disables every type left out, and the user discovers it weeks later by not
 * being notified. `mergeNotificationOptions` always emits all twenty.
 */

/** Every `NotificationType` AniList has, in the order its own settings list them. */
export const NOTIFICATION_TYPES = [
  "ACTIVITY_MESSAGE",
  "ACTIVITY_REPLY",
  "FOLLOWING",
  "ACTIVITY_MENTION",
  "THREAD_COMMENT_MENTION",
  "THREAD_SUBSCRIBED",
  "THREAD_COMMENT_REPLY",
  "AIRING",
  "ACTIVITY_LIKE",
  "ACTIVITY_REPLY_LIKE",
  "THREAD_LIKE",
  "THREAD_COMMENT_LIKE",
  "ACTIVITY_REPLY_SUBSCRIBED",
  "RELATED_MEDIA_ADDITION",
  "MEDIA_DATA_CHANGE",
  "MEDIA_MERGE",
  "MEDIA_DELETION",
  "MEDIA_SUBMISSION_UPDATE",
  "STAFF_SUBMISSION_UPDATE",
  "CHARACTER_SUBMISSION_UPDATE",
] as const;

export type NotificationTypeName = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationOption {
  type: string | null;
  enabled: boolean | null;
}

/**
 * The full twenty-entry array to send, given what the account currently has and
 * what the user just toggled.
 *
 * Always all twenty, never a patch. Anything the server did not report defaults
 * to enabled, matching AniList's own default for a type it has not stored.
 */
export function mergeNotificationOptions(
  current: NotificationOption[] | null | undefined,
  changes: Partial<Record<NotificationTypeName, boolean>>,
): { type: NotificationTypeName; enabled: boolean }[] {
  const now = new Map<string, boolean>();
  for (const o of current ?? []) {
    if (o?.type) now.set(o.type, o.enabled !== false);
  }
  return NOTIFICATION_TYPES.map((type) => ({
    type,
    enabled: changes[type] ?? now.get(type) ?? true,
  }));
}

/**
 * The four AniList settings Karasu deliberately ignores.
 *
 * Editing them is still legitimate — they are the user's settings and other
 * clients honour them — but a row that appears to do nothing is a bug report
 * waiting to happen, so each carries a note naming *where* its effect lands.
 * The hint keys are literals so `i18nKeys.test.ts` can see them.
 */
export const LOCAL_OVERRIDES = {
  scoreFormat: {
    hintKey: "settings.alOverrideScoreFormat",
    /** Which Karasu pane holds the setting that wins instead, if any. */
    pane: null,
  },
  titleLanguage: {
    hintKey: "settings.alOverrideTitleLanguage",
    pane: "appearance",
  },
  displayAdultContent: {
    hintKey: "settings.alOverrideAdult",
    pane: "content",
  },
  airingNotifications: {
    hintKey: "settings.alOverrideAiring",
    pane: "detection",
  },
} as const;

export type OverriddenField = keyof typeof LOCAL_OVERRIDES;

/** The form's editable shape — a subset of `UpdateUser`'s arguments. */
export interface UserSettingsForm {
  about?: string;
  titleLanguage?: string;
  staffNameLanguage?: string;
  scoreFormat?: string;
  rowOrder?: string;
  profileColor?: string;
  timezone?: string;
  activityMergeTime?: number;
  displayAdultContent?: boolean;
  airingNotifications?: boolean;
  restrictMessagesToFollowing?: boolean;
  notificationOptions?: { type: NotificationTypeName; enabled: boolean }[];
}

/**
 * The variables to send for exactly what changed.
 *
 * Absent means "don't change", which is the same convention
 * `bulkSaveEntries` already documents for list writes. Sending every field on
 * every save would make an unrelated stale value overwrite a change made
 * elsewhere.
 *
 * **Never emits `animeListOptions` or `mangaListOptions`.** See the file header;
 * there is a test for it.
 */
export function formToUpdateUserVars(
  form: UserSettingsForm,
): Record<string, unknown> {
  const vars: Record<string, unknown> = {};
  const put = (key: keyof UserSettingsForm) => {
    const value = form[key];
    if (value !== undefined) vars[key] = value;
  };

  put("about");
  put("titleLanguage");
  put("staffNameLanguage");
  put("scoreFormat");
  put("rowOrder");
  put("profileColor");
  put("timezone");
  put("activityMergeTime");
  put("displayAdultContent");
  put("airingNotifications");
  put("restrictMessagesToFollowing");
  put("notificationOptions");

  return vars;
}

/** Whether a form holds anything to send at all. */
export function hasChanges(form: UserSettingsForm): boolean {
  return Object.keys(formToUpdateUserVars(form)).length > 0;
}
