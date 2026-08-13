import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CornerDownRight, ExternalLink } from "lucide-react";
import type { FlatComment } from "@/lib/comments";
import { UserLockup } from "@/components/ui/user-lockup";
import { Markdown } from "./Markdown";
import { relTimeFromSeconds } from "@/lib/relTime";
import { cn } from "@/lib/utils";

/**
 * Comments, two levels deep, in reading order.
 *
 * `lib/comments` did the flattening and counted what sits below the cap; this
 * only draws it. The "N more on AniList" line exists because the alternative —
 * dropping a 48-deep chain silently — makes Karasu look like it lost the
 * conversation rather than declined to render it.
 */
export function CommentTree({ comments }: { comments: FlatComment[] }) {
  const { t, i18n } = useTranslation();

  return (
    <div className="space-y-3">
      {comments.map((c) => (
        <div
          key={c.id}
          className={cn(
            "rounded-xl border border-surface-800 bg-surface-900 p-3",
            // A reply is indented and quieter, so the two levels read apart
            // without needing a connector line.
            c.depth === 1 && "ml-6 border-surface-850 bg-surface-950",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {c.depth === 1 && (
                <CornerDownRight className="size-3 shrink-0 text-ink-600" />
              )}
              <Link
                to={`/user/${encodeURIComponent(c.user?.name ?? "")}`}
                className="min-w-0"
              >
                <UserLockup
                  name={c.user?.name ?? "—"}
                  src={c.user?.avatar?.medium}
                  size="sm"
                  nameClassName="text-xs font-medium text-ink-300"
                  sub={
                    <span className="block text-2xs text-ink-600">
                      {relTimeFromSeconds(c.createdAt, i18n.language, t("notif.now"))}
                    </span>
                  }
                />
              </Link>
            </div>
            {c.siteUrl && (
              <button
                onClick={() => void openUrl(c.siteUrl)}
                aria-label={t("social.openOnAniList")}
                title={t("social.openOnAniList")}
                className="shrink-0 text-ink-600 transition-surface hover:text-ink-300"
              >
                <ExternalLink className="size-3" />
              </button>
            )}
          </div>

          <Markdown source={c.comment} className="mt-2" />

          {c.hiddenReplies > 0 && c.depth === 1 && (
            <button
              onClick={() => void openUrl(c.siteUrl)}
              className="mt-2 text-2xs text-accent-400 hover:underline"
            >
              {t("social.deeperReplies", { n: c.hiddenReplies })}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
