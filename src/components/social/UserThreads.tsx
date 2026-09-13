import { useState } from "react";
import { useTranslation } from "react-i18next";
import { threads } from "@/api/social";
import { Pill } from "@/components/ui/pill";
import { ThreadList } from "./ThreadList";
import { UserComments } from "./UserComments";

/** A profile's Forum tab; no `threads(replyUserId:)` lens, since that only lists threads the user replied to last. */
type Lens = "created" | "comments";

export function UserThreads({ userId, name }: { userId: number; name: string }) {
  const { t } = useTranslation();
  // Comments first: almost everyone has said something, almost nobody has started a thread.
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

      {/* Keyed so the other lens unmounts rather than sitting behind this one with a live query observer. */}
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
