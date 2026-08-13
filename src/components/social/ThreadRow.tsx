import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Heart, Lock, MessageSquare, Pin, Eye } from "lucide-react";
import type { ThreadSummary } from "@/api/social";
import { relTimeFromSeconds } from "@/lib/relTime";

/** One thread in a list: the title, who is talking, and how busy it is. */
export function ThreadRow({ thread }: { thread: ThreadSummary }) {
  const { t, i18n } = useTranslation();
  const when = thread.repliedAt ?? thread.createdAt ?? 0;

  return (
    <Link
      to={`/thread/${thread.id}`}
      className="block rounded-xl border border-surface-800 bg-surface-900 p-3 transition-surface hover:border-surface-700"
    >
      <div className="flex items-start gap-2">
        {thread.isSticky && <Pin className="mt-0.5 size-3 shrink-0 text-accent-400" />}
        {thread.isLocked && <Lock className="mt-0.5 size-3 shrink-0 text-ink-600" />}
        <h3 className="min-w-0 flex-1 text-sm font-medium text-ink-100">
          {thread.title ?? t("social.untitledThread")}
        </h3>
      </div>

      {thread.categories && thread.categories.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {thread.categories.map((c) => (
            <span
              key={c.id}
              className="rounded border border-surface-700 px-1.5 py-0.5 text-2xs text-ink-600"
            >
              {c.name}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-600">
        <span>{thread.user?.name}</span>
        <span className="flex items-center gap-1">
          <MessageSquare className="size-2.75" />
          <span className="tabular-nums">{thread.replyCount ?? 0}</span>
        </span>
        <span className="flex items-center gap-1">
          <Eye className="size-2.75" />
          <span className="tabular-nums">{thread.viewCount ?? 0}</span>
        </span>
        <span className="flex items-center gap-1">
          <Heart className="size-2.75" />
          <span className="tabular-nums">{thread.likeCount ?? 0}</span>
        </span>
        {/* Last activity rather than creation — a thread's age is not what
            anyone scanning a forum list is looking for. */}
        {when > 0 && <span>{relTimeFromSeconds(when, i18n.language, t("notif.now"))}</span>}
      </div>
    </Link>
  );
}
