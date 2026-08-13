import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "./Markdown";
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
  const [preview, setPreview] = useState(false);

  if (mode !== "anilist" || !viewer) return null;

  const check = validatePost(text);
  const left = charsLeft(text);
  // Only once it is worth knowing — a counter on an empty box is noise.
  const showCount = left < POST_MAX * 0.15 || left < 0;

  const submit = () => {
    if (!check.ok || post.isPending) return;
    post.mutate(check.text, { onSuccess: () => { setText(""); setPreview(false); } });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="panel-wash panel-top rounded-xl border border-surface-800 bg-surface-900 p-3"
    >
      {preview ? (
        <div className="min-h-20 rounded-lg border border-surface-800 bg-surface-950 p-3">
          {check.ok ? (
            <Markdown source={check.text} />
          ) : (
            <p className="text-xs text-ink-600">{t("social.previewEmpty")}</p>
          )}
        </div>
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter sends; plain Enter is a newline, because AniList
            // renders single newlines as breaks and people write paragraphs.
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("social.composerPlaceholder")}
          rows={3}
          className="min-h-20 w-full resize-y rounded-lg border border-surface-700 bg-surface-950 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
        />
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPreview((v) => !v)}
            disabled={!text.trim()}
          >
            {preview ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {preview ? t("social.previewOff") : t("social.previewOn")}
          </Button>
          {showCount && (
            <span
              className={cn(
                "text-2xs tabular-nums",
                left < 0 ? "text-danger" : "text-ink-600",
              )}
            >
              {left}
            </span>
          )}
        </div>
        <Button type="submit" size="sm" disabled={!check.ok || post.isPending}>
          <Send className="size-3.5" />
          {post.isPending ? t("social.posting") : t("social.post")}
        </Button>
      </div>
    </form>
  );
}
