/** AniList account settings; the list-options inputs replace custom lists wholesale, so they are never sent. */

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

/** The whole `notificationOptions` array to send, never a patch: a partial write disables every type left out. */
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

/** Every `MediaListStatus`, one `disabledListActivity` entry each. */
export const LIST_ACTIVITY_STATUSES = [
  "CURRENT",
  "PLANNING",
  "COMPLETED",
  "DROPPED",
  "PAUSED",
  "REPEATING",
] as const;

export type ListActivityStatus = (typeof LIST_ACTIVITY_STATUSES)[number];

export interface ListActivityOption {
  disabled: boolean | null;
  type: string | null;
}

/** The whole `disabledListActivity` array to send, never a patch: a partial write resets every status left out. */
export function mergeListActivity(
  current: ListActivityOption[] | null | undefined,
  changes: Partial<Record<ListActivityStatus, boolean>>,
): { disabled: boolean; type: ListActivityStatus }[] {
  const now = new Map<string, boolean>();
  for (const o of current ?? []) {
    if (o?.type) now.set(o.type, o.disabled === true);
  }
  return LIST_ACTIVITY_STATUSES.map((type) => ({
    type,
    disabled: changes[type] ?? now.get(type) ?? false,
  }));
}

/** AniList settings whose effect lands elsewhere in Karasu, each with a literal hint key naming where. */
export const LOCAL_OVERRIDES = {
  titleLanguage: {
    hintKey: "settings.alOverrideTitleLanguage",
    /** Which Karasu pane holds the setting that wins instead, if any. */
    pane: "appearance",
  },
  displayAdultContent: {
    hintKey: "settings.alOverrideAdult",
    // The content filter lives in Appearance because it answers the same question the rest of that pane does.
    pane: "appearance",
  },
  airingNotifications: {
    hintKey: "settings.alOverrideAiring",
    // Read rather than overridden: while it is on, the airing watcher leaves the bell row to AniList's own.
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
  donatorBadge?: string;
  disabledListActivity?: { disabled: boolean; type: ListActivityStatus }[];
}

/** Only what changed; absent means "don't change", and `animeListOptions`/`mangaListOptions` are never emitted. */
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
  put("donatorBadge");
  put("disabledListActivity");

  return vars;
}

/** Whether a form holds anything to send at all. */
export function hasChanges(form: UserSettingsForm): boolean {
  return Object.keys(formToUpdateUserVars(form)).length > 0;
}
