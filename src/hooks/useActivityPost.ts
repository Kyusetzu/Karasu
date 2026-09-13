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

/** Posting and deleting a status update, the CLAUDE.md carve-out's own hook; neither is optimistic on purpose. */
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
      // Pushed onto the front of the loaded pages, because `refetch` on an infinite query refetches every retained page.
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
        // Never the post's text: `main.tsx` funnels errors into the diagnostics report a user pastes into a bug report.
        text: t("social.postFailed"),
        detail: t("social.postFailedDetail"),
      });
    },
  });

  /** Rewrites one activity under every prefix key that holds it, including its own page and other users' feeds. */
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
      // No undo offered, because AniList has no way to restore a deleted activity.
      showToast({ kind: "success", text: t("social.postDeleted") });
    },
    onError: () => {
      showToast({ kind: "error", text: t("social.deleteFailed") });
    },
  });

  /** Pins or unpins an own activity in place; ordering waits for the next refetch, and a refusal shows AniList's sentence. */
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
