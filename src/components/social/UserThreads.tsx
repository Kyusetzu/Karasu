import { useState } from "react";
import { useTranslation } from "react-i18next";
import { threads } from "@/api/social";
import { Pill } from "@/components/ui/pill";
import { ThreadList } from "./ThreadList";

/**
 * A profile's Forum tab: threads they started, and threads they replied to.
 *
 * Two lenses rather than one list, because AniList models them as two different
 * arguments (`userId` and `replyUserId`) with no way to ask for the union. Chips,
 * matching the search page and the forum index.
 *
 * The paging itself belongs to `ThreadList`, which the forum index shares — this
 * only chooses what to feed it.
 */
type Lens = "created" | "replied";

export function UserThreads({ userId, name }: { userId: number; name: string }) {
  const { t } = useTranslation();
  const [lens, setLens] = useState<Lens>("created");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(["created", "replied"] as const).map((l) => (
          <Pill key={l} active={lens === l} onClick={() => setLens(l)}>
            {l === "created" ? t("social.threadsCreated") : t("social.threadsReplied")}
          </Pill>
        ))}
      </div>

      {/* Keyed so the other lens unmounts rather than sitting behind this one
          with a live query observer. */}
      <div key={lens}>
        <ThreadList
          queryKey={["social", "threads", userId, lens]}
          fetchPage={(page) =>
            threads(lens === "created" ? { userId } : { replyUserId: userId }, page)
          }
          emptyTitle={
            lens === "created"
              ? t("social.noThreadsCreated", { name })
              : t("social.noThreadsReplied", { name })
          }
        />
      </div>
    </div>
  );
}
