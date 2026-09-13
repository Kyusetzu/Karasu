import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  saveActivityReply,
  toggleLike as toggleLikeApi,
  type ActivityPage,
  type ActivityReply,
  type LikeableType,
} from "@/api/social";
import { toggleLike as flipLike } from "@/lib/activity";
import { showToast } from "@/stores/toast";

/** Likes and replies with their cache patches in one place, since they write into neighbouring keys. */
export function useSocialActions() {
  const qc = useQueryClient();
  const { t } = useTranslation();

  /** Rewrites one activity wherever it is cached, across every loaded page. */
  const patchActivity = (
    id: number,
    apply: (a: { likeCount: number; isLiked: boolean }) => { likeCount: number; isLiked: boolean },
  ) => {
    for (const scope of ["activities", "feed"] as const) {
      qc.setQueriesData<InfiniteData<ActivityPage>>({ queryKey: ["social", scope] }, (old) => {
        if (!old) return old;
        let touched = false;
        const pages = old.pages.map((page) => ({
          ...page,
          activities: page.activities.map((raw) => {
            const a = raw as { id?: number; likeCount?: number | null; isLiked?: boolean | null };
            if (a?.id !== id) return raw;
            touched = true;
            const next = apply({ likeCount: a.likeCount ?? 0, isLiked: a.isLiked === true });
            return { ...a, ...next };
          }),
        }));
        return touched ? { ...old, pages } : old;
      });
    }
  };

  /** The same for a thread, a single cached object; keep it, or a thread like patches a same-numbered activity. */
  const patchThread = (
    id: number,
    apply: (a: { likeCount: number; isLiked: boolean }) => { likeCount: number; isLiked: boolean },
  ) => {
    qc.setQueryData<{ likeCount: number; isLiked: boolean } | null>(
      ["social", "thread", id],
      (old) =>
        old
          ? { ...old, ...apply({ likeCount: old.likeCount ?? 0, isLiked: old.isLiked === true }) }
          : old,
    );
  };

  /** The same for a reply, which lives in its own per-activity key. */
  const patchReply = (
    activityId: number,
    id: number,
    apply: (a: { likeCount: number; isLiked: boolean }) => { likeCount: number; isLiked: boolean },
  ) => {
    qc.setQueryData<ActivityReply[]>(["social", "activityReplies", activityId], (old) =>
      old?.map((r) =>
        r.id === id
          ? { ...r, ...apply({ likeCount: r.likeCount ?? 0, isLiked: r.isLiked === true }) }
          : r,
      ),
    );
  };

  /** Keep `THREAD_COMMENT` skipped in all three arms; comment and activity ids overlap, and `Thread.tsx` patches its own. */
  const like = useMutation({
    mutationFn: (vars: { id: number; type: LikeableType; activityId?: number }) =>
      toggleLikeApi(vars.id, vars.type),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["social"] });
      if (vars.type === "ACTIVITY_REPLY" && vars.activityId !== undefined) {
        patchReply(vars.activityId, vars.id, flipLike);
      } else if (vars.type === "THREAD") {
        patchThread(vars.id, flipLike);
      } else if (vars.type !== "THREAD_COMMENT") {
        patchActivity(vars.id, flipLike);
      }
    },
    onSuccess: (result, vars) => {
      // AniList returns the authoritative count, so replace the guess; a race with another client resolves here.
      if (!result) return;
      const settle = () => ({ likeCount: result.likeCount, isLiked: result.isLiked });
      if (vars.type === "ACTIVITY_REPLY" && vars.activityId !== undefined) {
        patchReply(vars.activityId, vars.id, settle);
      } else if (vars.type === "THREAD") {
        patchThread(vars.id, settle);
      } else if (vars.type !== "THREAD_COMMENT") {
        patchActivity(vars.id, settle);
      }
    },
    onError: (_err, vars) => {
      // `flipLike` is its own inverse, so the undo is the same call again rather than a stored snapshot.
      if (vars.type === "ACTIVITY_REPLY" && vars.activityId !== undefined) {
        patchReply(vars.activityId, vars.id, flipLike);
      } else if (vars.type === "THREAD") {
        patchThread(vars.id, flipLike);
      } else if (vars.type !== "THREAD_COMMENT") {
        patchActivity(vars.id, flipLike);
      }
      showToast({
        kind: "error",
        text: t("social.likeFailed"),
        detail: t("social.likeFailedDetail"),
      });
    },
  });

  const reply = useMutation({
    mutationFn: (vars: { activityId: number; text: string }) =>
      saveActivityReply(vars.activityId, vars.text),
    // Deliberately not optimistic: a reply carries the user's own words, and a failure must not erase them.
    onSuccess: (created, vars) => {
      qc.setQueryData<ActivityReply[]>(
        ["social", "activityReplies", vars.activityId],
        (old) => (old ? [...old, created] : [created]),
      );
      // The feed's own `replyCount` has to move too, or the row keeps the old number until staleTime lapses.
      bumpReplyCount(qc, vars.activityId);
    },
    onError: (_err, vars) => {
      showToast({
        kind: "error",
        // Never the reply text; `main.tsx` funnels errors into the diagnostics report, and it must not travel.
        text: t("social.replyFailed"),
        detail: t("social.replyFailedDetail"),
        action: { label: t("common.retry"), run: () => reply.mutate(vars) },
      });
    },
  });

  return { like, reply };
}

/** `replyCount` lives on the activity, not the reply list, so it moves apart. */
function bumpReplyCount(qc: ReturnType<typeof useQueryClient>, activityId: number) {
  for (const scope of ["activities", "feed"] as const) {
    qc.setQueriesData<InfiniteData<ActivityPage>>({ queryKey: ["social", scope] }, (old) => {
      if (!old) return old;
      let touched = false;
      const pages = old.pages.map((page) => ({
        ...page,
        activities: page.activities.map((raw) => {
          const a = raw as { id?: number; replyCount?: number | null };
          if (a?.id !== activityId) return raw;
          touched = true;
          return { ...a, replyCount: (a.replyCount ?? 0) + 1 };
        }),
      }));
      return touched ? { ...old, pages } : old;
    });
  }
}
