import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { saveReview } from "@/api/social";
import {
  REVIEW_BODY_MIN,
  REVIEW_SUMMARY_MAX,
  validateReview,
  type ReviewRejection,
} from "@/lib/composer";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/social/Markdown";
import { showToast } from "@/stores/toast";
import { cn } from "@/lib/utils";

/** Literal `t()` call per case — the guard's regex only sees those, so a
    switch returning bare key strings would sit outside the suite's reach. */
function reasonText(
  reason: ReviewRejection,
  t: (k: string, o?: Record<string, unknown>) => string,
  n: number,
): string {
  switch (reason) {
    case "summaryTooShort":
      return t("review.summaryTooShort");
    case "summaryTooLong":
      return t("review.summaryTooLong");
    case "bodyTooShort":
      return t("review.bodyTooShort", { n });
    case "scoreOut":
      return t("review.scoreOut");
  }
}

/**
 * Writing (or editing) a review — `NewThreadModal`'s shape, with the bounds
 * AniList itself enforces surfaced while typing: the 2,200-character body
 * floor especially, which would otherwise only ever appear as a failed
 * request. Not optimistic, like every composer: it is the user's own words.
 *
 * Editing repopulates from the row the reviews query already fetched;
 * `SaveReview` with an `id` is the upsert (introspection in `api/social`).
 */
export function ReviewComposerModal({
  mediaId,
  existing,
  onClose,
  leaving,
}: {
  mediaId: number;
  existing?: {
    id: number;
    summary: string | null;
    body: string | null;
    score: number | null;
    private: boolean;
  } | null;
  onClose: () => void;
  leaving?: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [summary, setSummary] = useState(existing?.summary ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [score, setScore] = useState(existing?.score ?? 0);
  const [priv, setPriv] = useState(existing?.private ?? false);
  const [preview, setPreview] = useState(false);

  const check = validateReview(summary, body, score);
  // The floor is the surprising bound, so the counter is always visible —
  // unlike the activity composer's, which only appears near the ceiling.
  // Counted on `check.body` — the newline-collapsed form actually sent —
  // so the number can never disagree with the gate it explains.
  const bodyLen = check.body.length;

  const save = useMutation({
    mutationFn: () =>
      saveReview({
        ...(existing ? { id: existing.id } : {}),
        mediaId,
        summary: check.summary,
        body: check.body,
        score,
        private: priv,
      }),
    onSuccess: () => {
      // Trim to the first page before invalidating: the fold's infinite query
      // is active right behind this modal, and invalidating an active infinite
      // query refetches *every* retained page — the trap `Thread`'s comment
      // box documents. One page retained means one request spent.
      qc.setQueryData<{ pages: unknown[]; pageParams: unknown[] }>(
        ["social", "reviews", mediaId],
        (old) =>
          old ? { pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) } : old,
      );
      void qc.invalidateQueries({ queryKey: ["social", "reviews", mediaId] });
      showToast({ kind: "success", text: t("review.saved") });
      onClose();
    },
    onError: () =>
      showToast({
        kind: "error",
        text: t("review.saveFailed"),
        detail: t("review.saveFailedDetail"),
      }),
  });

  const submit = () => {
    if (!check.ok || save.isPending) return;
    save.mutate();
  };

  return (
    <Modal
      title={t(existing ? "review.editTitle" : "review.writeTitle")}
      onClose={onClose}
      leaving={leaving}
      className="max-w-2xl"
    >
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-ink-300" htmlFor="review-summary">
            {t("review.summaryLabel")}
          </label>
          <Input
            id="review-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder={t("review.summaryPlaceholder")}
            maxLength={REVIEW_SUMMARY_MAX}
            className="mt-1.5"
          />
        </div>

        <div>
          {/* `htmlFor` only when the textarea it names is rendered. In preview
              mode the field is replaced by the rendered markdown, so the id
              pointed at nothing — a label referencing a missing control is
              worse than a plain caption, because assistive tech reports the
              association and then cannot follow it. */}
          <label
            className="block text-xs font-medium text-ink-300"
            htmlFor={preview ? undefined : "review-body"}
          >
            {t("review.bodyLabel")}
          </label>
          {preview ? (
            <div className="mt-1.5 min-h-36 max-h-80 overflow-y-auto rounded-lg border border-surface-800 bg-surface-950 p-3">
              {body.trim() ? (
                <Markdown source={check.body} />
              ) : (
                <p className="text-xs text-ink-600">{t("social.previewEmpty")}</p>
              )}
            </div>
          ) : (
            <textarea
              id="review-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={t("review.bodyPlaceholder")}
              rows={12}
              className="mt-1.5 min-h-36 w-full resize-y rounded-lg border border-surface-700 bg-surface-950 px-3 py-2 text-sm focus:border-accent-500 focus:outline-none"
            />
          )}
          <div className="mt-1 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPreview((v) => !v)}
              disabled={!body.trim()}
            >
              {preview ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {preview ? t("social.previewOff") : t("social.previewOn")}
            </Button>
            <span
              className={cn(
                "text-2xs tabular-nums",
                bodyLen < REVIEW_BODY_MIN ? "text-ink-600" : "text-success",
              )}
            >
              {bodyLen.toLocaleString()} / {REVIEW_BODY_MIN.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-xs font-medium text-ink-300">
            {t("review.scoreLabel")}
            <Input
              type="number"
              min={0}
              max={100}
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
              className="w-20"
            />
            <span className="text-2xs text-ink-600">/ 100</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-300">
            <input
              type="checkbox"
              checked={priv}
              onChange={(e) => setPriv(e.target.checked)}
              className="size-3.5 accent-accent-500"
            />
            {t("review.privateLabel")}
          </label>
        </div>

        {!check.ok && check.reason !== undefined && (summary.length > 0 || bodyLen > 0) && (
          <p className="text-2xs text-gold">{reasonText(check.reason, t, bodyLen)}</p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-surface-800 pt-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={submit} disabled={!check.ok || save.isPending}>
            {save.isPending ? t("review.publishing") : t("review.publish")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
