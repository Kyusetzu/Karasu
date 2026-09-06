import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { saveThread, THREAD_CATEGORIES } from "@/api/social";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { MarkdownTextarea } from "@/components/social/MarkdownTextarea";
import { charsLeft, POST_MAX, TITLE_MAX, validateThread } from "@/lib/composer";
import { showToast } from "@/stores/toast";
import { cn } from "@/lib/utils";

/**
 * Create a forum thread: a title, at least one category, and a markdown body.
 *
 * Create-only on purpose — editing and deleting a thread stay on anilist.co,
 * where a destructive click has the site's own confirm around it (the
 * `saveThread` comment in `api/social` records the introspection).
 *
 * Not optimistic, like the comment box: it is the user's own words, and a
 * failure that erased them would be worse than a moment of waiting. The
 * preview renders through the same `Markdown` the thread page uses, so the
 * post is learned before it is public rather than after.
 */
export function NewThreadModal({
  onClose,
  leaving,
}: {
  onClose: () => void;
  leaving?: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [categories, setCategories] = useState<Set<number>>(new Set());

  const check = validateThread(title, body, [...categories]);
  const left = charsLeft(body);

  const create = useMutation({
    mutationFn: () =>
      saveThread({ title: check.title, body: check.body, categories: [...categories] }),
    onSuccess: (res) => {
      // The listing this thread now belongs to is stale, whichever lens shows it.
      void qc.invalidateQueries({ queryKey: ["social", "forum"] });
      onClose();
      navigate(`/thread/${res.id}`);
    },
    onError: () =>
      showToast({
        kind: "error",
        text: t("forum.createFailed"),
        detail: t("forum.createFailedDetail"),
      }),
  });

  const submit = () => {
    if (!check.ok || create.isPending) return;
    create.mutate();
  };

  const toggleCategory = (id: number) =>
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal title={t("forum.newThread")} onClose={onClose} leaving={leaving} className="max-w-2xl">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-ink-300" htmlFor="thread-title">
            {t("forum.threadTitleLabel")}
          </label>
          <Input
            id="thread-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("forum.threadTitlePlaceholder")}
            maxLength={TITLE_MAX}
            className="mt-1.5"
          />
        </div>

        <div>
          <span className="block text-xs font-medium text-ink-300">
            {t("forum.categoriesLabel")}
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {THREAD_CATEGORIES.map((c) => (
              <Pill key={c.id} active={categories.has(c.id)} onClick={() => toggleCategory(c.id)}>
                {c.name}
              </Pill>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-300" htmlFor="thread-body">
            {t("forum.bodyLabel")}
          </label>
          <MarkdownTextarea
            id="thread-body"
            className="mt-1.5"
            value={body}
            onChange={setBody}
            onSubmit={submit}
            placeholder={t("forum.bodyPlaceholder")}
            rows={8}
            preview="toggle"
            previewSource={body.trim() ? check.body : ""}
            textareaClassName="min-h-36"
            footer={
              (left < POST_MAX * 0.15 || left < 0) && (
                <span
                  className={cn("text-2xs tabular-nums", left < 0 ? "text-danger" : "text-ink-600")}
                >
                  {left}
                </span>
              )
            }
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-surface-800 pt-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={submit} disabled={!check.ok || create.isPending}>
            {create.isPending ? t("forum.creating") : t("forum.create")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
