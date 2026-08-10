import { useTranslation } from "react-i18next";
import { Check, UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/stores/auth";
import { useFollow } from "@/hooks/useFollow";
import { followRelation, isFollowing, isSelf, type FollowFlags } from "@/lib/follows";
import { useState } from "react";

/**
 * Follow / unfollow, wherever a user appears.
 *
 * Renders nothing at all rather than a disabled control when there is nobody to
 * follow *as* — signed out, in the account-free local mode, or looking at
 * yourself. A greyed-out button in those cases would be an invitation with no
 * explanation.
 *
 * The label swaps to "Unfollow" only on hover or focus, so a row of followed
 * users reads as a list of states rather than a wall of identical buttons, and
 * the destructive reading is only there when the pointer is on it.
 */
export function FollowButton({
  userId,
  name,
  flags,
  size = "sm",
}: {
  userId: number;
  name: string;
  flags: FollowFlags;
  size?: "sm" | "control";
}) {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const follow = useFollow();
  const [hot, setHot] = useState(false);

  if (mode !== "anilist" || !viewer || isSelf(viewer.id, userId)) return null;

  const relation = followRelation(flags);
  const following = isFollowing(relation);
  const showUnfollow = following && hot;

  return (
    <Button
      variant={following ? "outline" : "default"}
      size={size}
      disabled={follow.isPending}
      onClick={() => follow.mutate({ userId, name })}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
      // The accessible name must be the action, not the state — a screen reader
      // reading "Following" on a button implies pressing it would follow.
      aria-label={
        following
          ? t("social.unfollowAria", { name })
          : t("social.followAria", { name })
      }
      className="shrink-0"
    >
      {showUnfollow ? (
        <>
          <UserMinus className="size-3.5" /> {t("social.unfollow")}
        </>
      ) : following ? (
        <>
          <Check className="size-3.5" /> {t("social.following")}
        </>
      ) : (
        <>
          <UserPlus className="size-3.5" /> {t("social.follow")}
        </>
      )}
    </Button>
  );
}
