import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownTextarea } from "./MarkdownTextarea";
import { charsLeft, POST_MAX, validatePost } from "@/lib/composer";
import { useActivityPost } from "@/hooks/useActivityPost";
import { useAuth } from "@/stores/auth";
import { cn } from "@/lib/utils";

/**
 * Post a status update to AniList.
 *
 * The feature CLAUDE.md's second carve-out is about — the paragraph explains
 * what was decided and, more importantly, what is still refused.
 *
 * The preview toggle is not decoration. It renders through the same `Markdown`
 * component the feed uses, which is the only way anyone discovers *which*
 * markdown Karasu supports: images become chips here exactly as they will in the
 * post, so the surprise happens before sending rather than after.
 */
export function ActivityComposer() {
  const { t } = useTranslation();
  const viewer = useAuth((s) => s.viewer);
  const mode = useAuth((s) => s.mode);
  const { post } = useActivityPost(viewer?.id);
  const [text, setText] = useState("");

  if (mode !== "anilist" || !viewer) return null;

  const check = validatePost(text);
  const left = charsLeft(text);
  // Only once it is worth knowing — a counter on an empty box is noise.
  const showCount = left < POST_MAX * 0.15 || left < 0;

  const submit = () => {
    if (!check.ok || post.isPending) return;
    post.mutate(check.text, { onSuccess: () => setText("") });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="panel-wash panel-top rounded-xl border border-surface-800 bg-surface-900 p-3"
    >
      <MarkdownTextarea
        value={text}
        onChange={setText}
        onSubmit={submit}
        placeholder={t("social.composerPlaceholder")}
        rows={3}
        preview="toggle"
        previewSource={check.ok ? check.text : ""}
        textareaClassName="min-h-20"
        footer={
          showCount && (
            <span
              className={cn(
                "text-2xs tabular-nums",
                left < 0 ? "text-danger" : "text-ink-600",
              )}
            >
              {left}
            </span>
          )
        }
        actions={
          <Button type="submit" size="sm" disabled={!check.ok || post.isPending}>
            <Send className="size-3.5" />
            {post.isPending ? t("social.posting") : t("social.post")}
          </Button>
        }
      />
    </form>
  );
}
