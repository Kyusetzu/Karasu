import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CornerDownRight, ExternalLink, Heart, Reply } from "lucide-react";
import type { FlatComment } from "@/lib/comments";
import { UserLockup } from "@/components/ui/user-lockup";
import { cardClass } from "@/components/ui/card";
import { Markdown } from "./Markdown";
import { relTimeFromSeconds } from "@/lib/relTime";
import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Comments two levels deep, in reading order; `lib/comments` did the flattening and this only draws it. */
export function CommentTree({
  comments,
  onLike,
  onReply,
  replyingTo,
  highlightId,
  children,
}: {
  comments: FlatComment[];
  /** The `?comment=` landing row; the ring is persistent because reduced motion would collapse a fade. */
  highlightId?: number;
  /** Omitted when there is nobody to like as — the button then does not exist. */
  onLike?: (c: FlatComment) => void;
  /** Opens a reply box; the caller parents to `c.rootId`, never `c.id`, or a depth-two reply vanishes. */
  onReply?: (c: FlatComment) => void;
  /** Which comment currently has the box open, if any. */
  replyingTo?: number | null;
  /** The box itself, supplied by the caller so this file stays a renderer. */
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const highlightRef = useRef<HTMLDivElement | null>(null);

  // Once per target, not per array identity, or every like or refetch would re-scroll under the reader.
  useEffect(() => {
    if (highlightId == null) return;
    highlightRef.current?.scrollIntoView({
      block: "center",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [highlightId]);

  return (
    <div className="space-y-3">
      {comments.map((c) => (
        <div
          key={c.id}
          ref={c.id === highlightId ? highlightRef : undefined}
          className={cn(
            cardClass(c.depth === 1 ? "sunken" : "flat"),
            "rounded-panel p-3",
            // A reply is indented and quieter, so the two levels read apart without a connector line.
            c.depth === 1 && "ml-6 border-surface-850",
            c.id === highlightId && "border-accent-500/70 ring-1 ring-accent-500/30",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {c.depth === 1 && (
                <CornerDownRight className="size-3.5 shrink-0 text-ink-600" />
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
                <ExternalLink className="size-3.5" />
              </button>
            )}
          </div>

          <Markdown source={c.comment} className="mt-2" />

          <div className="mt-2 flex items-center gap-1">
            {onLike && (
              <button
                onClick={() => onLike(c)}
                aria-pressed={c.isLiked}
                className={cn(
                  "flex items-center gap-1 rounded-inner px-1.5 py-0.5 text-2xs transition-surface hover:bg-surface-850",
                  c.isLiked ? "text-danger" : "text-ink-600 hover:text-ink-300",
                )}
              >
                <Heart className={cn("size-3.5", c.isLiked && "fill-current")} />
                <span className="tabular-nums">{c.likeCount}</span>
              </button>
            )}
            {onReply && (
              <button
                onClick={() => onReply(c)}
                className="flex items-center gap-1 rounded-inner px-1.5 py-0.5 text-2xs text-ink-600 transition-surface hover:bg-surface-850 hover:text-ink-300"
              >
                <Reply className="size-3.5" />
                {t("social.reply")}
              </button>
            )}
          </div>

          {replyingTo === c.id && children}

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
