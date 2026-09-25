import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronRight, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getNotifSchedule, isTauri, setNotifSchedule } from "@/api/anilist";
import { notificationOptions, userProfile } from "@/api/social";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shimmer } from "@/components/Skeleton";
import { showToast } from "@/stores/toast";
import { ExternalNote, NeedsAccount, Row, SELECT, Toggle } from "./shared";
import {
  LIST_ACTIVITY_STATUSES,
  LOCAL_OVERRIDES,
  mergeListActivity,
  mergeNotificationOptions,
  NOTIFICATION_TYPES,
  type ListActivityStatus,
  type NotificationTypeName,
  type OverriddenField,
} from "@/lib/anilistUserFields";
import { useUpdateUser } from "@/hooks/useUpdateUser";
import { useAuth } from "@/stores/auth";
import { isAndroid, usePlatform } from "@/stores/platform";
import { cn } from "@/lib/utils";
import { notifScheduleFailure } from "@/lib/notifSchedule";

/** AniList's own account settings, served from the profile's cache entry; bio and colour stay in the profile editor. */

const TITLE_LANGUAGES = [
  "ROMAJI",
  "ENGLISH",
  "NATIVE",
  "ROMAJI_STYLISED",
  "ENGLISH_STYLISED",
  "NATIVE_STYLISED",
] as const;

const STAFF_LANGUAGES = ["ROMAJI_WESTERN", "ROMAJI", "NATIVE"] as const;

const SCORE_FORMATS = [
  "POINT_100",
  "POINT_10_DECIMAL",
  "POINT_10",
  "POINT_5",
  "POINT_3",
] as const;

const ROW_ORDERS = ["title", "score", "updatedAt", "id"] as const;

/** Literal switches for the selects, so `i18nKeys.test.ts` sees every key; the raw enum values are not labels. */
function titleLanguageLabel(v: (typeof TITLE_LANGUAGES)[number], t: (k: string) => string): string {
  switch (v) {
    case "ROMAJI": return t("settings.alTitleRomaji");
    case "ENGLISH": return t("settings.alTitleEnglish");
    case "NATIVE": return t("settings.alTitleNative");
    case "ROMAJI_STYLISED": return t("settings.alTitleRomajiStylised");
    case "ENGLISH_STYLISED": return t("settings.alTitleEnglishStylised");
    case "NATIVE_STYLISED": return t("settings.alTitleNativeStylised");
  }
}

function staffLanguageLabel(v: (typeof STAFF_LANGUAGES)[number], t: (k: string) => string): string {
  switch (v) {
    case "ROMAJI_WESTERN": return t("settings.alStaffRomajiWestern");
    case "ROMAJI": return t("settings.alStaffRomaji");
    case "NATIVE": return t("settings.alStaffNative");
  }
}

function scoreFormatLabel(v: (typeof SCORE_FORMATS)[number], t: (k: string) => string): string {
  switch (v) {
    case "POINT_100": return t("settings.alScore100");
    case "POINT_10_DECIMAL": return t("settings.alScore10Decimal");
    case "POINT_10": return t("settings.alScore10");
    case "POINT_5": return t("settings.alScore5");
    case "POINT_3": return t("settings.alScore3");
  }
}

function rowOrderLabel(v: (typeof ROW_ORDERS)[number], t: (k: string) => string): string {
  switch (v) {
    case "title": return t("settings.alRowTitle");
    case "score": return t("settings.alRowScore");
    case "updatedAt": return t("settings.alRowUpdated");
    case "id": return t("settings.alRowAdded");
  }
}

/** The note for a setting Karasu overrides, with a link to what wins instead. */
function OverrideNote({ field }: { field: OverriddenField }) {
  const { t } = useTranslation();
  const o = LOCAL_OVERRIDES[field];
  return (
    <ExternalNote>
      {/* Literal keys, one per field, so `i18nKeys.test.ts` resolves them. */}
      {field === "titleLanguage"
        ? t("settings.alOverrideTitleLanguage")
        : field === "displayAdultContent"
          ? t("settings.alOverrideAdult")
          : t("settings.alOverrideAiring")}
      {o.pane && (
        <>
          {" "}
          <Link
            to={`/settings?pane=${o.pane}`}
            className="text-accent-400 underline hover:no-underline"
          >
            {t("settings.alOverrideWhere")}
          </Link>
        </>
      )}
    </ExternalNote>
  );
}

function useViewerSettings() {
  const viewer = useAuth((s) => s.viewer);
  const q = useQuery({
    queryKey: ["social", "user", viewer?.name ?? ""],
    queryFn: () => userProfile({ name: viewer!.name }),
    enabled: isTauri && !!viewer?.name,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  return { viewer, ...q };
}

/** The pane's answer without an account; the sections below return null, which read as a crash. */
export function AniListSignedOutNote() {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);

  if (viewer) return null;
  return (
    <NeedsAccount title={t("settings.alSignedOut")}>
      {t("settings.alSignedOutHint")}
    </NeedsAccount>
  );
}

export function AniListProfileSection() {
  const { t } = useTranslation();
  const { viewer, data, isLoading } = useViewerSettings();
  const save = useUpdateUser(viewer?.name);

  if (!viewer) return null;

  const options = data?.options;

  return (
    <Card>
      <CardTitle>{t("settings.alAccount")}</CardTitle>
      <p className="mt-1 text-xs text-ink-600">{t("settings.alAccountHint")}</p>

      <div className="mt-4 space-y-3">
        {isLoading || !options ? (
          <Shimmer className="h-24 w-full rounded-control" />
        ) : (
          <>
            <Row
              label={t("settings.alTitleLanguage")}
              hint={t("settings.alTitleLanguageHint")}
              note={<OverrideNote field="titleLanguage" />}
            >
              <select
                value={options.titleLanguage ?? "ROMAJI"}
                disabled={save.isPending}
                onChange={(e) => save.mutate({ titleLanguage: e.target.value })}
                className={SELECT}
              >
                {TITLE_LANGUAGES.map((v) => (
                  <option key={v} value={v}>
                    {titleLanguageLabel(v, t)}
                  </option>
                ))}
              </select>
            </Row>

            <Row
              label={t("settings.alStaffLanguage")}
              hint={t("settings.alStaffLanguageHint")}
            >
              <select
                value={options.staffNameLanguage ?? "ROMAJI_WESTERN"}
                disabled={save.isPending}
                onChange={(e) => save.mutate({ staffNameLanguage: e.target.value })}
                className={SELECT}
              >
                {STAFF_LANGUAGES.map((v) => (
                  <option key={v} value={v}>
                    {staffLanguageLabel(v, t)}
                  </option>
                ))}
              </select>
            </Row>

            <Row label={t("settings.alTimezone")} hint={t("settings.alTimezoneHint")}>
              <input
                type="text"
                defaultValue={options.timezone ?? ""}
                placeholder="+01:00"
                disabled={save.isPending}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next !== (options.timezone ?? "")) save.mutate({ timezone: next });
                }}
                className={cn(SELECT, "w-24")}
              />
            </Row>

            <Row
              label={t("settings.alMergeTime")}
              hint={t("settings.alMergeTimeHint")}
            >
              <input
                type="number"
                min={0}
                max={1440}
                defaultValue={options.activityMergeTime ?? 0}
                disabled={save.isPending}
                onBlur={(e) => {
                  const next = Math.max(0, Math.min(1440, Number(e.target.value)));
                  if (next !== (options.activityMergeTime ?? 0)) {
                    save.mutate({ activityMergeTime: next });
                  }
                }}
                className={cn(SELECT, "w-20")}
              />
            </Row>

            <div className="border-t border-hair pt-3">
              <Toggle
                checked={options.displayAdultContent === true}
                disabled={save.isPending}
                onChange={(v) => save.mutate({ displayAdultContent: v })}
                label={t("settings.alAdult")}
                hint={t("settings.alAdultHint")}
              />
              <OverrideNote field="displayAdultContent" />
            </div>

            <div>
              <Toggle
                checked={options.airingNotifications === true}
                disabled={save.isPending}
                onChange={(v) => save.mutate({ airingNotifications: v })}
                label={t("settings.alAiring")}
                hint={t("settings.alAiringHint")}
              />
              <OverrideNote field="airingNotifications" />
            </div>

            <Toggle
              checked={options.restrictMessagesToFollowing === true}
              disabled={save.isPending}
              onChange={(v) => save.mutate({ restrictMessagesToFollowing: v })}
              label={t("settings.alRestrictMessages")}
              hint={t("settings.alRestrictMessagesHint")}
            />

            <Row
              label={t("settings.alDonatorBadge")}
              hint={
                (data?.donatorTier ?? 0) > 0
                  ? t("settings.alDonatorBadgeHint")
                  : t("settings.alDonatorBadgeLocked")
              }
            >
              <input
                type="text"
                defaultValue={data?.donatorBadge ?? ""}
                maxLength={24}
                disabled={save.isPending || (data?.donatorTier ?? 0) === 0}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next && next !== (data?.donatorBadge ?? "")) {
                    save.mutate({ donatorBadge: next });
                  }
                }}
                className={cn(SELECT, "w-40")}
              />
            </Row>

            {/* Per-status activity muting; `mergeListActivity` sends the whole array, so one flip cannot reset the rest. */}
            <div className="border-t border-hair pt-3">
              <p className="text-sm text-ink-100">{t("settings.alListActivity")}</p>
              <p className="mt-0.5 text-xs text-ink-600">{t("settings.alListActivityHint")}</p>
              <div className="mt-2 space-y-1">
                {LIST_ACTIVITY_STATUSES.map((status) => (
                  <Toggle
                    key={status}
                    checked={!isActivityMuted(options.disabledListActivity, status)}
                    disabled={save.isPending}
                    onChange={(posts) =>
                      save.mutate({
                        disabledListActivity: mergeListActivity(
                          options.disabledListActivity,
                          { [status]: !posts },
                        ),
                      })
                    }
                    label={listActivityLabel(status, t)}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {/* Stated rather than hidden: the API has no mutation for these, so no client can offer them. */}
        <ExternalNote>{t("settings.alNoUpload")}</ExternalNote>

        <div className="flex flex-wrap gap-2 border-t border-hair pt-3">
          <Link to={`/user/${encodeURIComponent(viewer.name)}`}>
            <Button variant="secondary" size="sm">
              {t("settings.alEditBio")}
            </Button>
          </Link>
          <Button variant="ghost" size="sm" onClick={() => void openUrl(viewer.siteUrl)}>
            {t("settings.alOpenSite")} <ExternalLink className="size-3" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Whether a status is currently muted in the server's array. */
function isActivityMuted(
  current: { disabled: boolean | null; type: string | null }[] | null | undefined,
  status: ListActivityStatus,
): boolean {
  return (current ?? []).some((o) => o?.type === status && o.disabled === true);
}

/** A literal switch, for `i18nKeys.test.ts` and because these labels cover anime and manga at once. */
function listActivityLabel(status: ListActivityStatus, t: (k: string) => string): string {
  switch (status) {
    case "CURRENT":
      return t("settings.alActCurrent");
    case "PLANNING":
      return t("settings.alActPlanning");
    case "COMPLETED":
      return t("settings.alActCompleted");
    case "DROPPED":
      return t("settings.alActDropped");
    case "PAUSED":
      return t("settings.alActPaused");
    case "REPEATING":
      return t("settings.alActRepeating");
  }
}

export function AniListListOptionsSection() {
  const { t } = useTranslation();
  const { viewer, data, isLoading } = useViewerSettings();
  const save = useUpdateUser(viewer?.name);

  if (!viewer) return null;
  const mlo = data?.mediaListOptions;

  return (
    <Card>
      <CardTitle>{t("settings.alListOptions")}</CardTitle>
      <div className="mt-3 space-y-3">
        {isLoading || !mlo ? (
          <Shimmer className="h-16 w-full rounded-control" />
        ) : (
          <>
            <Row
              label={t("settings.alScoreFormat")}
              hint={t("settings.alScoreFormatHint")}
            >
              <select
                value={mlo.scoreFormat ?? "POINT_10"}
                disabled={save.isPending}
                onChange={(e) => save.mutate({ scoreFormat: e.target.value })}
                className={SELECT}
              >
                {SCORE_FORMATS.map((v) => (
                  <option key={v} value={v}>
                    {scoreFormatLabel(v, t)}
                  </option>
                ))}
              </select>
            </Row>

            <Row label={t("settings.alRowOrder")} hint={t("settings.alRowOrderHint")}>
              <select
                value={mlo.rowOrder ?? "title"}
                disabled={save.isPending}
                onChange={(e) => save.mutate({ rowOrder: e.target.value })}
                className={SELECT}
              >
                {ROW_ORDERS.map((v) => (
                  <option key={v} value={v}>
                    {rowOrderLabel(v, t)}
                  </option>
                ))}
              </select>
            </Row>

            {/* Read-only on purpose: `customLists` is a full replacement with no undo, so never send it (`lib/anilistUserFields`). */}
            <div className="rounded-control border border-hair bg-surface-950 p-3">
              <p className="text-xs font-medium text-ink-300">
                {t("settings.alCustomLists")}
              </p>
              <p className="mt-1 text-2xs text-ink-600">
                {t("settings.alCustomListsHint")}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {[
                  ...(mlo.animeList?.customLists ?? []),
                  ...(mlo.mangaList?.customLists ?? []),
                ].map((name, i) => (
                  <span
                    key={`${name}-${i}`}
                    className="rounded-inner border border-surface-700 px-1.5 py-0.5 text-2xs text-ink-500"
                  >
                    {name}
                  </span>
                ))}
                {!(mlo.animeList?.customLists ?? []).length &&
                  !(mlo.mangaList?.customLists ?? []).length && (
                    <span className="text-2xs text-ink-600">
                      {t("settings.alCustomListsNone")}
                    </span>
                  )}
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/** The notification toggles, collapsed; fetched fresh on merge, because `UpdateUser` replaces the whole array. */
export function AniListNotificationsSection() {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const [open, setOpen] = useState(false);
  const save = useUpdateUser(viewer?.name);

  const q = useQuery({
    queryKey: ["social", "notificationOptions", viewer?.id],
    queryFn: () => notificationOptions(viewer!.id),
    enabled: isTauri && !!viewer?.id && open,
    // Must be fresh at the moment of merging: the write replaces the whole array.
    staleTime: 0,
    gcTime: 60 * 1000,
  });

  if (!viewer) return null;

  const current = new Map(
    (q.data ?? []).map((o) => [o.type, o.enabled !== false] as const),
  );

  return (
    <Card>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span>
          <CardTitle>{t("settings.alNotifications")}</CardTitle>
          <span className="mt-1 block text-xs text-ink-600">
            {t("settings.alNotificationsHint")}
          </span>
        </span>
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-ink-500 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>

      {open && (
        <div className="mt-4 space-y-1">
          {q.isLoading && <Shimmer className="h-40 w-full rounded-control" />}
          {q.error && (
            <p className="text-sm text-danger">
              {t("common.error", { message: String(q.error) })}
            </p>
          )}
          {!q.isLoading &&
            !q.error &&
            NOTIFICATION_TYPES.map((type) => (
              <Toggle
                key={type}
                checked={current.get(type) ?? true}
                disabled={save.isPending || q.isFetching}
                onChange={(v) =>
                  save.mutate({
                    // The whole array, every time.
                    notificationOptions: mergeNotificationOptions(q.data, {
                      [type]: v,
                    } as Partial<Record<NotificationTypeName, boolean>>),
                  })
                }
                label={notificationLabel(type, t)}
              />
            ))}
        </div>
      )}
    </Card>
  );
}

/** A literal `t()` per type, so `i18nKeys.test.ts` sees every key; a template key is invisible to it. */
function notificationLabel(
  type: NotificationTypeName,
  t: (k: string) => string,
): string {
  switch (type) {
    case "ACTIVITY_MESSAGE": return t("settings.alNotifActivityMessage");
    case "ACTIVITY_REPLY": return t("settings.alNotifActivityReply");
    case "FOLLOWING": return t("settings.alNotifFollowing");
    case "ACTIVITY_MENTION": return t("settings.alNotifActivityMention");
    case "THREAD_COMMENT_MENTION": return t("settings.alNotifThreadMention");
    case "THREAD_SUBSCRIBED": return t("settings.alNotifThreadSubscribed");
    case "THREAD_COMMENT_REPLY": return t("settings.alNotifThreadReply");
    case "AIRING": return t("settings.alNotifAiring");
    case "ACTIVITY_LIKE": return t("settings.alNotifActivityLike");
    case "ACTIVITY_REPLY_LIKE": return t("settings.alNotifActivityReplyLike");
    case "THREAD_LIKE": return t("settings.alNotifThreadLike");
    case "THREAD_COMMENT_LIKE": return t("settings.alNotifThreadCommentLike");
    case "ACTIVITY_REPLY_SUBSCRIBED": return t("settings.alNotifReplySubscribed");
    case "RELATED_MEDIA_ADDITION": return t("settings.alNotifRelatedMedia");
    case "MEDIA_DATA_CHANGE": return t("settings.alNotifMediaDataChange");
    case "MEDIA_MERGE": return t("settings.alNotifMediaMerge");
    case "MEDIA_DELETION": return t("settings.alNotifMediaDeletion");
    case "MEDIA_SUBMISSION_UPDATE": return t("settings.alNotifMediaSubmission");
    case "STAFF_SUBMISSION_UPDATE": return t("settings.alNotifStaffSubmission");
    case "CHARACTER_SUBMISSION_UPDATE": return t("settings.alNotifCharacterSubmission");
  }
}

/** How often the background check runs, off by default; one key drives both platforms, so the floor is Android's. */
export function NotificationScheduleSection() {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const android = isAndroid(usePlatform((s) => s.info));
  const [minutes, setMinutes] = useState<number | null>(null);
  const [custom, setCustom] = useState(false);
  // The field's text while editing; a number input bound straight to committed state is uneditable.
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    getNotifSchedule().then((m) => {
      setMinutes(m);
      setCustom(m !== 0 && ![15, 30, 60].includes(m));
    });
  }, []);

  if (!viewer || minutes === null) return null;

  const commit = (m: number) => {
    setMinutes(m);
    // Never swallow the rejection; the setting stays stored, and `notifScheduleFailure` says which sentence is true.
    setNotifSchedule(m).catch((e) => {
      const failure = notifScheduleFailure(String(e));
      const refused = failure.kind === "refused";
      const detail = refused
        ? [t("settings.notifJobRefusedHint"), failure.detail].filter(Boolean).join(" · ")
        : failure.detail;
      // A phone truncates each toast line, so the short fact leads and the platform's own reason trails.
      showToast({
        kind: "error",
        text: refused ? t("settings.notifJobRefused") : t("settings.notifScheduleFailed"),
        detail: detail || undefined,
      });
    });
  };

  return (
    <Card>
      <CardTitle>{t("settings.notifSchedule")}</CardTitle>
      <p className="mt-2 text-sm text-ink-500">{t("settings.notifScheduleHint")}</p>
      {/* Android's standby buckets stretch the job; the exemption under Detection is the lever, so it is named here. */}
      {android && (
        <p className="mt-1 text-xs text-ink-600">
          {t("settings.notifScheduleAndroidHint")}{" "}
          <Link to="/settings?pane=detection" className="text-accent-400 hover:underline">
            {t("settings.pane_detection")}
          </Link>
        </p>
      )}
      <div className="mt-3">
        <Row label={t("settings.notifScheduleLabel")}>
          <select
            className={SELECT}
            value={custom ? "custom" : String(minutes)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") {
                setCustom(true);
                setDraft(String(minutes || 15));
                if (minutes === 0) commit(15);
                return;
              }
              setCustom(false);
              setDraft(null);
              commit(Number(v));
            }}
          >
            <option value="0">{t("settings.notifScheduleOff")}</option>
            <option value="15">{t("settings.notifSchedule15")}</option>
            <option value="30">{t("settings.notifSchedule30")}</option>
            <option value="60">{t("settings.notifSchedule60")}</option>
            <option value="custom">{t("settings.notifScheduleCustom")}</option>
          </select>
        </Row>
        {custom && (
          <Row label={t("settings.notifScheduleCustomLabel")}>
            <Input
              type="number"
              min={15}
              max={720}
              step={5}
              className="max-w-24 text-right tabular-nums"
              value={draft ?? String(minutes)}
              onChange={(e) => {
                const raw = e.target.value;
                setDraft(raw);
                const n = Number(raw);
                if (raw !== "" && Number.isFinite(n) && n >= 15) {
                  commit(Math.min(720, Math.round(n)));
                }
              }}
              onBlur={() => setDraft(null)}
            />
          </Row>
        )}
      </div>
    </Card>
  );
}
