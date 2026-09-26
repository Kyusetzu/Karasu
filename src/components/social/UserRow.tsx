import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { SocialUser } from "@/api/social";
import { UserLockup } from "@/components/ui/user-lockup";
import { cardClass } from "@/components/ui/card";
import { FollowButton } from "./FollowButton";
import { followRelation, relationBadgeKey } from "@/lib/follows";
import { cn } from "@/lib/utils";

/** One person in a list; no bio line, because `FOLLOWERS_QUERY` does not ask for one and a page of bios is a heavy payload. */
export function UserRow({ user }: { user: SocialUser }) {
  const { t } = useTranslation();
  const relation = followRelation(user);
  const badgeKey = relationBadgeKey(relation);

  return (
    <div className={cn(cardClass("flat", { interactive: true }), "flex items-center gap-3 p-3")}>
      <Link
        to={`/user/${encodeURIComponent(user.name)}`}
        className="min-w-0 flex-1"
      >
        <UserLockup
          name={user.name}
          src={user.avatar?.medium}
          size="md"
          titleAttr
          nameClassName="text-sm"
          sub={
            badgeKey ? (
              <span className="block text-2xs text-ink-600">
                {badgeKey === "social.badgeMutual"
                  ? t("social.badgeMutual")
                  : t("social.badgeFollowsYou")}
              </span>
            ) : undefined
          }
        />
      </Link>
      <FollowButton userId={user.id} name={user.name} flags={user} />
    </div>
  );
}
