import { useState } from "react";
import { useTranslation } from "react-i18next";
import { threads } from "@/api/social";
import { Pill } from "@/components/ui/pill";
import { ThreadList } from "./ThreadList";
import { UserComments } from "./UserComments";

/**
 * A profile's Forum tab: threads they started, and everything they have said.
 *
 * The two lenses mirror anilist.co's own profile ("Forum Threads" / "Forum
 * Comments"). A third lens used to sit here — `threads(replyUserId:)`,
 * labelled "Replied to" — and it was quietly misleading: that argument lists
 * threads where the user is the *most recent* replier, so someone whose reply
 * was answered five minutes later vanished from their own tab. A real case
 * proved it: a user with three comments in thread 1 showed an empty "Replied
 * to" because someone replied after them. The comments lens answers the
 * question that tab was pretending to.
 *
 * The paging itself belongs to `ThreadList` / `UserComments`; this only
 * chooses what to feed.
 */
type Lens = "created" | "comments";

export function UserThreads({ userId, name }: { userId: number; name: string }) {
  const { t } = useTranslation();
  // Comments first: almost everyone has said something, almost nobody has
  // started a thread — and the per-comment landing makes this the lens the
  // profile's visitors actually come for.
  const [lens, setLens] = useState<Lens>("comments");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(["created", "comments"] as const).map((l) => (
          <Pill key={l} active={lens === l} onClick={() => setLens(l)}>
            {l === "created" ? t("social.threadsCreated") : t("social.threadsComments")}
          </Pill>
        ))}
      </div>

      {/* Keyed so the other lens unmounts rather than sitting behind this one
          with a live query observer. */}
      <div key={lens}>
        {lens === "created" ? (
          <ThreadList
            queryKey={["social", "threads", userId, lens]}
            fetchPage={(page) => threads({ userId }, page)}
            emptyTitle={t("social.noThreadsCreated", { name })}
          />
        ) : (
          <UserComments
            userId={userId}
            emptyTitle={t("social.noUserComments", { name })}
          />
        )}
      </div>
    </div>
  );
}
