import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { updateUser, type UserProfile } from "@/api/social";
import {
  formToUpdateUserVars,
  type UserSettingsForm,
} from "@/lib/anilistUserFields";
import { useAuth } from "@/stores/auth";
import { showToast } from "@/stores/toast";

/** Saves AniList account settings, deliberately not optimistic; success writes the returned `User` into the profile cache. */
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
                // Field by field, not spread: `UpdateUser` returns only two fields, and a spread would drop the list options.
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
      // The notification array lives under its own always-fresh key (`NOTIFICATION_OPTIONS_QUERY`), so it is told too.
      if (updated?.options?.notificationOptions) {
        qc.setQueryData(
          ["social", "notificationOptions", updated.id],
          updated.options.notificationOptions,
        );
      }
      // Rust reads these three off the cached viewer blob, which only `refresh_viewer` rewrites; recache or they wait.
      const needsViewer =
        form.scoreFormat !== undefined ||
        form.airingNotifications !== undefined ||
        form.notificationOptions !== undefined;
      if (needsViewer) await useAuth.getState().refreshViewer();
      // The blanket invalidation stays the score format's alone: it rescales every score in the app, nothing else does.
      if (form.scoreFormat !== undefined) await qc.invalidateQueries();
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
