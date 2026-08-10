import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { SocialUser } from "@/api/social";
import { UserLockup } from "@/components/ui/user-lockup";
import { FollowButton } from "./FollowButton";
import { followRelation, relationBadgeKey } from "@/lib/follows";

/**
 * One person in a list.
 *
 * No bio line, deliberately — see `FOLLOWERS_QUERY`. A bio runs to several
 * kilobytes and fifty of them would be a half-megabyte payload for a row that
 * shows a name and a button, so the query does not ask for one and this cannot
 * render one.
 */
export function UserRow({ user }: { user: SocialUser }) {
  const { t } = useTranslation();
  const relation = followRelation(user);
  const badgeKey = relationBadgeKey(relation);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-surface-800 bg-surface-900 p-3 transition-surface hover:border-surface-700">
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
