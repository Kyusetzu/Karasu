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

/**
 * Likes and replies, with their cache patches in one place.
 *
 * One file rather than one per mutation because they write into neighbouring
 * keys: a reply changes an activity's `replyCount` in the feed *and* appends to
 * that activity's reply list. Splitting them would put half of that map in each
 * file and guarantee they drift.
 *
 * A like is optimistic and silent. There is no toast: a heart that fills is its
 * own receipt, and `useListMutations`'s rule — every optimistic write needs a
 * visible, reversible receipt — is satisfied by the icon itself, which is
 * also the undo. A *failed* like still speaks up, because that is the case the
 * UI has already lied about.
 */
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

  /**
   * And for a thread, which is a single cached object rather than a page.
   *
   * Without this the `else` branch below patched an *activity* with the
   * thread's id — nothing on the thread page, and a same-numbered activity
   * elsewhere if one happened to be loaded. The heart on a thread simply did
   * not move, while the request behind it succeeded.
   */
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

  const like = useMutation({
    mutationFn: (vars: { id: number; type: LikeableType; activityId?: number }) =>
      toggleLikeApi(vars.id, vars.type),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["social"] });
      if (vars.type === "ACTIVITY_REPLY" && vars.activityId !== undefined) {
        patchReply(vars.activityId, vars.id, flipLike);
      } else if (vars.type === "THREAD") {
        patchThread(vars.id, flipLike);
      } else {
        patchActivity(vars.id, flipLike);
      }
    },
    onSuccess: (result, vars) => {
      // AniList returns the authoritative count, so replace the guess rather
      // than keeping it — this is where a race with another client resolves.
      if (!result) return;
      const settle = () => ({ likeCount: result.likeCount, isLiked: result.isLiked });
      if (vars.type === "ACTIVITY_REPLY" && vars.activityId !== undefined) {
        patchReply(vars.activityId, vars.id, settle);
      } else if (vars.type === "THREAD") {
        patchThread(vars.id, settle);
      } else {
        patchActivity(vars.id, settle);
      }
    },
    onError: (_err, vars) => {
      // `flipLike` is its own inverse, so undoing the optimistic patch is the
      // same call again rather than a stored snapshot.
      if (vars.type === "ACTIVITY_REPLY" && vars.activityId !== undefined) {
        patchReply(vars.activityId, vars.id, flipLike);
      } else if (vars.type === "THREAD") {
        patchThread(vars.id, flipLike);
      } else {
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
    // Deliberately *not* optimistic. A reply carries the user's own words, and
    // showing it as posted before the server has it means a failure erases
    // something they wrote. The box stays disabled for the round trip instead.
    onSuccess: (created, vars) => {
      qc.setQueryData<ActivityReply[]>(
        ["social", "activityReplies", vars.activityId],
        (old) => (old ? [...old, created] : [created]),
      );
      // The feed's own `replyCount` has to move too, or the row still says the
      // old number until its staleTime lapses.
      bumpReplyCount(qc, vars.activityId);
    },
    onError: (_err, vars) => {
      showToast({
        kind: "error",
        // The text is never in the message. `main.tsx` funnels errors into the
        // diagnostics report a user pastes into a bug report, and a reply's
        // body is the last thing that should travel with it.
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
