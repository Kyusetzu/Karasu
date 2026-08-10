import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toggleFollow, type SocialUser, type UserPage, type UserProfile } from "@/api/social";
import { followRelation, nextRelation, relationFlags } from "@/lib/follows";
import { showToast } from "@/stores/toast";

/**
 * Follow and unfollow, optimistically, from anywhere.
 *
 * Four screens can start this — a profile header, a follower row, a following
 * row, a search result — and the same user can be on screen in more than one of
 * them at once. So the patch does not target "the thing that was clicked"; it
 * rewrites every cached place that user appears, keyed on id.
 *
 * Follows the shape `useListMutations` established: cancel, snapshot, patch,
 * receipt with an undo, restore and offer a retry on failure. The one difference
 * is that undo here is the *same* call again — `nextRelation` is its own
 * inverse, so unfollowing is following applied twice.
 */
export function useFollow() {
  const qc = useQueryClient();
  const { t } = useTranslation();

  /** Rewrites this user wherever they are cached, and returns what to undo to. */
  const patch = (userId: number, apply: (relation: ReturnType<typeof followRelation>) => ReturnType<typeof followRelation>) => {
    // Profiles: keyed by name, so the id is not in the key and every entry has
    // to be examined. There are only ever a handful.
    qc.setQueriesData<UserProfile>({ queryKey: ["social", "user"] }, (old) => {
      if (!old || old.id !== userId) return old;
      return { ...old, ...relationFlags(apply(followRelation(old))) };
    });

    // Follower / following / search pages: infinite queries, so every loaded
    // page has to be walked. Cheap — these are arrays of fifty at most.
    for (const scope of ["followers", "following", "userSearch"] as const) {
      qc.setQueriesData<InfiniteData<UserPage>>({ queryKey: ["social", scope] }, (old) => {
        if (!old) return old;
        let touched = false;
        const pages = old.pages.map((page) => {
          if (!page.users.some((u) => u.id === userId)) return page;
          touched = true;
          return {
            ...page,
            users: page.users.map((u: SocialUser) =>
              u.id === userId ? { ...u, ...relationFlags(apply(followRelation(u))) } : u,
            ),
          };
        });
        // Returning a new object when nothing changed would re-render every
        // consumer of every page for no reason.
        return touched ? { ...old, pages } : old;
      });
    }
  };

  const follow = useMutation({
    mutationFn: (vars: { userId: number; name: string }) => toggleFollow(vars.userId),
    onMutate: async ({ userId }) => {
      await qc.cancelQueries({ queryKey: ["social"] });
      // Read the relation before patching, so the receipt can name what changed.
      const before = readRelation(qc, userId);
      patch(userId, nextRelation);
      return { before };
    },
    onSuccess: (result, { name }) => {
      // AniList returns the authoritative flags, so replace the guess rather
      // than trusting it — a race with another client resolves here.
      if (result) patch(result.id, () => followRelation(result));
      const nowFollowing = result?.isFollowing === true;
      showToast({
        kind: "success",
        text: nowFollowing
          ? t("social.followedToast", { name })
          : t("social.unfollowedToast", { name }),
        action: {
          label: t("receipt.undo"),
          run: () => follow.mutate({ userId: result.id, name }),
        },
      });
    },
    onError: (_err, vars, ctx) => {
      // The UI already showed this as done, so the rollback is invisible
      // without a receipt saying otherwise.
      if (ctx?.before) patch(vars.userId, () => ctx.before!);
      showToast({
        kind: "error",
        // Deliberately only the name and a generic reason. `main.tsx` funnels
        // errors into the diagnostics report a user pastes into a bug report,
        // and a social mutation's variables are the last thing to put there.
        text: t("social.followFailed", { name: vars.name }),
        detail: t("social.followFailedDetail"),
        action: { label: t("common.retry"), run: () => follow.mutate(vars) },
      });
    },
  });

  return follow;
}

/** The relation currently cached for a user, from wherever they appear first. */
function readRelation(
  qc: ReturnType<typeof useQueryClient>,
  userId: number,
): ReturnType<typeof followRelation> {
  for (const [, data] of qc.getQueriesData<UserProfile>({ queryKey: ["social", "user"] })) {
    if (data && data.id === userId) return followRelation(data);
  }
  for (const scope of ["followers", "following", "userSearch"] as const) {
    for (const [, data] of qc.getQueriesData<InfiniteData<UserPage>>({
      queryKey: ["social", scope],
    })) {
      for (const page of data?.pages ?? []) {
        const hit = page.users.find((u) => u.id === userId);
        if (hit) return followRelation(hit);
      }
    }
  }
  return "none";
}
