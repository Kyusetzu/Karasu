import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  deleteActivity,
  saveTextActivity,
  type ActivityPage,
} from "@/api/social";
import { showToast } from "@/stores/toast";

/**
 * Posting and deleting a status update.
 *
 * Its own file because it is the one hook carrying the CLAUDE.md override: this
 * is the mutation the rejected-features carve-out exists for. Keeping it apart
 * from `useSocialActions` means the diff that adds posting is the diff that
 * amends the document.
 *
 * Neither is optimistic. A post is the user's own words — showing it as sent
 * before the server has it means a failure erases something they wrote — and a
 * delete is irreversible, so claiming it early would be claiming something
 * unrecoverable. Both wait for the round trip.
 */
export function useActivityPost(viewerId: number | undefined) {
  const qc = useQueryClient();
  const { t } = useTranslation();

  /** The feeds a new post belongs at the front of. */
  const feedKeys = () =>
    [
      ["social", "feed", viewerId] as const,
      ["social", "activities", viewerId] as const,
    ].filter(() => viewerId !== undefined);

  const post = useMutation({
    mutationFn: (text: string) => saveTextActivity(text),
    onSuccess: (created) => {
      // Pushed onto the front of the loaded pages rather than invalidating.
      // `refetch` on an infinite query refetches *every* retained page, so a
      // post from someone six pages deep would cost six requests to show one
      // new row.
      for (const key of feedKeys()) {
        qc.setQueryData<InfiniteData<ActivityPage>>(key, (old) => {
          if (!old?.pages.length) return old;
          const [first, ...rest] = old.pages;
          return {
            ...old,
            pages: [
              { ...first, activities: [{ __typename: "TextActivity", ...created }, ...first.activities] },
              ...rest,
            ],
          };
        });
      }
      showToast({
        kind: "success",
        text: t("social.posted"),
        action: {
          label: t("social.deletePost"),
          run: () => remove.mutate(created.id),
        },
      });
    },
    onError: () => {
      showToast({
        kind: "error",
        // Never the text. `main.tsx` funnels errors into the diagnostics report
        // a user pastes into a bug report.
        text: t("social.postFailed"),
        detail: t("social.postFailedDetail"),
      });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteActivity(id),
    onSuccess: (_ok, id) => {
      for (const key of feedKeys()) {
        qc.setQueryData<InfiniteData<ActivityPage>>(key, (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((p) => ({
                  ...p,
                  activities: p.activities.filter(
                    (raw) => (raw as { id?: number })?.id !== id,
                  ),
                })),
              }
            : old,
        );
      }
      // No undo offered, because there is none: AniList has no way to restore a
      // deleted activity, and a button implying otherwise would be a lie.
      showToast({ kind: "success", text: t("social.postDeleted") });
    },
    onError: () => {
      showToast({ kind: "error", text: t("social.deleteFailed") });
    },
  });

  return { post, remove };
}
