import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { updateUser, type UserProfile } from "@/api/social";
import {
  formToUpdateUserVars,
  type UserSettingsForm,
} from "@/lib/anilistUserFields";
import { useAuth } from "@/stores/auth";
import { showToast } from "@/stores/toast";

/**
 * Saving AniList account settings.
 *
 * **Deliberately not optimistic**, unlike every other mutation in this feature.
 * A settings control that flips and then silently reverts is worse than one that
 * waits: the user walks away believing a change landed. So the row shows a
 * pending state and only moves once the server agrees.
 *
 * On success the returned `User` is written into the profile's cache entry, so
 * the pane and the viewer's own profile both update without a refetch — they
 * share `["social", "user", <name>]` by design.
 */
export function useUpdateUser(viewerName: string | undefined) {
  const qc = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (form: UserSettingsForm) => updateUser(formToUpdateUserVars(form)),
    onSuccess: async (updated, form) => {
      if (viewerName && updated) {
        qc.setQueryData<UserProfile>(["social", "user", viewerName], (old) =>
          old
            ? {
                ...old,
                about: updated.about ?? old.about,
                options: updated.options ?? old.options,
                // Written field by field rather than spread: `UpdateUser`
                // returns only `scoreFormat` and `rowOrder`, and spreading over
                // a possibly-null previous value would drop `animeList` and
                // `mangaList` — the two the pane shows read-only precisely
                // because they must never be sent.
                mediaListOptions: updated.mediaListOptions
                  ? {
                      scoreFormat: updated.mediaListOptions.scoreFormat,
                      rowOrder: updated.mediaListOptions.rowOrder,
                      animeList: old.mediaListOptions?.animeList ?? null,
                      mangaList: old.mediaListOptions?.mangaList ?? null,
                    }
                  : old.mediaListOptions,
              }
            : old,
        );
      }
      // The notification array is read from its own always-fresh key, so it has
      // to be told too — see `NOTIFICATION_OPTIONS_QUERY`.
      if (updated?.options?.notificationOptions) {
        qc.setQueryData(
          ["social", "notificationOptions", updated.id],
          updated.options.notificationOptions,
        );
      }
      // A score-format change rescales every score in the app: refresh the
      // stored viewer (which recaches the format the save paths convert
      // through), then drop the whole query cache — a rare, whole-scale
      // event, and the one place a blanket invalidation is proportionate.
      if (form.scoreFormat !== undefined) {
        await useAuth.getState().refreshViewer();
        await qc.invalidateQueries();
      }
      showToast({ kind: "success", text: t("settings.alSaved") });
    },
    onError: () => {
      showToast({
        kind: "error",
        text: t("settings.alSaveFailed"),
        detail: t("settings.alSaveFailedDetail"),
      });
    },
  });
}
