import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Plus } from "lucide-react";
import { saveListEntry } from "@/api/anilist";
import type { MediaDetail } from "@/api/queries";
import { displayTitle, STATUS_ORDER, type MediaListStatus, type SaveEntryInput } from "@/api/types";
import { Popover } from "@/components/ui/popover";
import { useListMutations } from "@/hooks/useListMutations";
import { withCompletion } from "@/lib/completion";
import { readableInk, UI_INK } from "@/lib/contrast";
import { entryFromEcho } from "@/lib/listEcho";
import { statusColorVar } from "@/lib/statusColors";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useTheme } from "@/stores/theme";
import { showToast } from "@/stores/toast";

/** The detail page's status as a control: it says where the title sits, and opens the six statuses to move it. */
export function StatusMenu({
  media,
  entry,
  progressLabel,
  className,
}: {
  media: MediaDetail;
  /** Null when the title is not on the list, and the button offers to add it. */
  entry: { status: MediaListStatus } | null;
  progressLabel: string | null;
  /** On the popover's box, which is the row's flex item; the button fills it. */
  className?: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const userId = useAuth((s) => s.viewer?.id) ?? 0;
  // The raw hexes, not the var(): readableInk needs a colour it can measure, and a CSS variable is opaque to it.
  const statusColors = useTheme((s) => s.statusColors);
  const { save } = useListMutations(userId, media.type);
  const key = ["mediaDetail", media.id];
  const title = displayTitle(media.title);

  const settle = (echo: unknown) => {
    const next = entryFromEcho(echo);
    if (next) qc.setQueryData<MediaDetail>(key, (old) => (old ? { ...old, mediaListEntry: next } : old));
  };

  // A first add goes out with the media object, which a new local entry needs and the list hook's save does not carry.
  const add = useMutation({
    mutationFn: (status: MediaListStatus) =>
      saveListEntry(withCompletion<SaveEntryInput>({ mediaId: media.id, status }, media, media.type, null), media),
    onSuccess: (res) => {
      settle(res.entry);
      // Scoped to this title's own collection; no patch can invent an entry the list has never held.
      void qc.invalidateQueries({ queryKey: ["mediaList", media.type] });
      if (res.queued) showToast({ kind: "info", text: t("receipt.queued", { title }) });
    },
    onError: () =>
      showToast({ kind: "error", text: t("receipt.failed", { title }), detail: t("receipt.failedDetail") }),
  });

  const move = (from: MediaListStatus, status: MediaListStatus) => {
    const input = withCompletion<SaveEntryInput>({ mediaId: media.id, status }, media, media.type, from);
    const before = qc.getQueryData<MediaDetail>(key);
    const stub = before?.mediaListEntry;
    // Moved at once like the list's own copy, so the button and the list never disagree while the write is out.
    if (before && stub) {
      qc.setQueryData<MediaDetail>(key, {
        ...before,
        mediaListEntry: { ...stub, status, progress: input.progress ?? stub.progress },
      });
    }
    // The hook owns the receipt, Undo and the error toast; this only keeps the page's copy in step.
    save.mutateAsync(input).then(
      (res) => settle(res?.entry),
      () => {
        if (before) qc.setQueryData(key, before);
      },
    );
  };

  const choose = (status: MediaListStatus) => {
    if (!entry) add.mutate(status);
    else if (entry.status !== status) move(entry.status, status);
  };

  return (
    <Popover
      label={t("actions.changeStatus")}
      variant="sheet"
      className={className}
      renderTrigger={(p) => (
        <button
          type="button"
          {...p}
          disabled={add.isPending}
          title={t("actions.changeStatus")}
          className={cn(
            "flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl px-3.5 text-sm font-semibold transition-surface",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:opacity-60",
            !entry && "border border-dashed border-surface-600 text-ink-200 hover:border-surface-500",
          )}
          style={
            entry
              ? {
                  backgroundColor: statusColorVar(entry.status),
                  // The palette is user-chosen, so readableInk picks whichever ink end has contrast against their hue.
                  color: readableInk(statusColors[entry.status] ?? "#000000", UI_INK),
                }
              : undefined
          }
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {!entry && <Plus aria-hidden className="size-4 shrink-0" />}
            <span className="truncate">
              {entry ? t(`status.${media.type}.${entry.status}`) : t("detail.addToList")}
            </span>
            {entry && progressLabel && <span className="shrink-0 font-medium opacity-75">{progressLabel}</span>}
          </span>
          <ChevronDown aria-hidden className="size-4 shrink-0 opacity-80" />
        </button>
      )}
    >
      {({ close }) => (
        <div className="space-y-0.5">
          {STATUS_ORDER.map((s) => {
            const current = entry?.status === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={current}
                onClick={() => {
                  close();
                  choose(s);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm transition-surface",
                  "focus-visible:outline-2 focus-visible:outline-accent-500",
                  current ? "bg-surface-850 text-ink-100" : "text-ink-300 hover:bg-surface-850/60 hover:text-ink-100",
                )}
              >
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: statusColorVar(s) }} />
                <span className="flex-1">{t(`status.${media.type}.${s}`)}</span>
                {current && <Check aria-hidden className="size-4 text-accent-400" />}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
