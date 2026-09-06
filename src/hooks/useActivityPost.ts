import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  deleteActivity,
  saveTextActivity,
  toggleActivityPin,
  type ActivityPage,
} from "@/api/social";
import { backendErrorText } from "@/lib/backendError";
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

  /**
   * Rewrites one activity in every feed that holds it, whoever's feed it is.
   *
   * Prefix keys, not the viewer's two: the activity is also cached under
   * `["social", "activity", id]` by its own page, and under other users'
   * feeds when it was seen there. The exact-key version patched the two
   * feeds and left the page the click was made on unchanged.
   */
  const patchEverywhere = (id: number, apply: (raw: object) => object | null) => {
    for (const scope of ["feed", "activities"] as const) {
      qc.setQueriesData<InfiniteData<ActivityPage>>({ queryKey: ["social", scope] }, (old) => {
        if (!old) return old;
        let touched = false;
        const pages = old.pages.map((p) => ({
          ...p,
          activities: p.activities.flatMap((raw) => {
            if ((raw as { id?: number })?.id !== id) return [raw];
            touched = true;
            const next = apply(raw as object);
            return next ? [next] : [];
          }),
        }));
        return touched ? { ...old, pages } : old;
      });
    }
    qc.setQueryData<unknown>(["social", "activity", id], (old: unknown) =>
      old ? apply(old as object) : old,
    );
  };

  const remove = useMutation({
    mutationFn: (id: number) => deleteActivity(id),
    onSuccess: (_ok, id) => {
      patchEverywhere(id, () => null);
      // No undo offered, because there is none: AniList has no way to restore a
      // deleted activity, and a button implying otherwise would be a lie.
      showToast({ kind: "success", text: t("social.postDeleted") });
    },
    onError: () => {
      showToast({ kind: "error", text: t("social.deleteFailed") });
    },
  });

  /**
   * Pin or unpin one of the viewer's own activities.
   *
   * The flag is patched in place across the loaded pages — the *ordering*
   * (pinned floats to the top of the profile feed) only changes on the next
   * refetch, which is honest: reshuffling rows under the cursor to celebrate a
   * click is worse than a badge appearing where the row already is.
   *
   * A refusal carries AniList's own sentence into the toast: pinning is a
   * donator feature over there, and "Sorry, you must be at least a tier 2
   * donator" is the whole explanation. `lib/donator` keeps the control off
   * accounts the viewer query already knows cannot pin; this covers the
   * viewer blob that predates the field.
   */
  const pin = useMutation({
    mutationFn: (vars: { id: number; pinned: boolean }) =>
      toggleActivityPin(vars.id, vars.pinned),
    onSuccess: (res, vars) => {
      const isPinned = res?.isPinned ?? vars.pinned;
      patchEverywhere(vars.id, (raw) => ({ ...raw, isPinned }));
    },
    onError: (err) => {
      showToast({
        kind: "error",
        text: t("social.pinFailed"),
        detail: backendErrorText(err, t),
      });
    },
  });

  return { post, remove, pin };
}
