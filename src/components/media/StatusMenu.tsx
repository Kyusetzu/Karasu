import { useEffect, useRef, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, Plus } from "lucide-react";
import { saveListEntry } from "@/api/anilist";
import type { MediaDetail } from "@/api/queries";
import { displayTitle, type MediaListStatus, type SaveEntryInput } from "@/api/types";
import { QuickEditor, type EntryPatch, type QuickEntry } from "@/components/media/QuickEditor";
import { Popover } from "@/components/ui/popover";
import { useListMutations } from "@/hooks/useListMutations";
import { withCompletion } from "@/lib/completion";
import { entryFromEcho } from "@/lib/listEcho";
import { loadDefaultAddStatus } from "@/lib/defaultAddStatus";
import { statusColorVar } from "@/lib/statusColors";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { showToast } from "@/stores/toast";

/** The detail page's entry as one control: the button says where the title sits, and opens the quick editor. */
export function StatusMenu({
  media,
  entry,
  progressLabel,
  variant,
  className,
}: {
  media: MediaDetail;
  /** Null when the title is not on the list, and the button offers to add it. */
  entry: QuickEntry | null;
  progressLabel: string | null;
  /** The phone's wide button over a sheet, or the desktop's compact one over a dropdown. */
  variant: "sheet" | "dropdown";
  /** On the popover's box, which is the row's flex item; the button fills it. */
  className?: string;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const userId = useAuth((s) => s.viewer?.id) ?? 0;
  const { save } = useListMutations(userId, media.type);
  const key = ["mediaDetail", media.id];
  const splitRef = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  // Set when the one-press add held focus, so the status button that replaces it can take focus over once it lands.
  const refocus = useRef(false);
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

  const write = (patch: EntryPatch) => {
    if (!entry) return;
    const input = withCompletion<SaveEntryInput>({ mediaId: media.id, ...patch }, media, media.type, entry.status);
    const before = qc.getQueryData<MediaDetail>(key);
    const stub = before?.mediaListEntry;
    // Shown at once like the list's own copy, so the page and the list never disagree while the write is out.
    if (before && stub) {
      qc.setQueryData<MediaDetail>(key, {
        ...before,
        mediaListEntry: {
          ...stub,
          status: input.status ?? stub.status,
          progress: input.progress ?? stub.progress,
          score: input.score ?? stub.score,
          repeat: input.repeat ?? stub.repeat,
          notes: input.notes ?? stub.notes,
        },
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

  useEffect(() => {
    if (!entry || !refocus.current) return;
    refocus.current = false;
    if (!document.activeElement || document.activeElement === document.body) trigger.current?.focus();
  }, [entry]);

  const choose = (status: MediaListStatus) => {
    if (!entry) add.mutate(status);
    else if (entry.status !== status) write({ status });
  };

  const sheet = variant === "sheet";
  const box = sheet ? "h-11 w-full rounded-panel text-sm" : "h-9 rounded-control text-sm";
  const ring = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:opacity-60";
  const defaultStatus = loadDefaultAddStatus();
  const defaultLabel = t(`status.${media.type}.${defaultStatus}`);
  return (
    <Popover
      label={t("detail.myEntry")}
      variant={variant}
      width={380}
      className={className}
      anchorRef={entry ? undefined : splitRef}
      openOnHover={!entry && !add.isPending}
      renderTrigger={(p) => (
        // One box in both states, so the status button that follows the chevron is the same element and keeps focus.
        <div
          ref={splitRef}
          className={cn(
            entry
              ? "contents"
              : "flex min-w-0 items-stretch border border-dashed border-surface-600 font-semibold text-ink-100 transition-surface hover:border-ink-600",
            !entry && box,
          )}
        >
          {/* The label adds with the default status at once; the chevron, or a resting mouse, offers the others. */}
          {!entry && (
            <>
              <button
                type="button"
                // Not `disabled` while the add is out: a disabled button drops focus, and this one should keep it.
                aria-disabled={add.isPending}
                onClick={(e) => {
                  if (add.isPending) return;
                  refocus.current = document.activeElement === e.currentTarget;
                  add.mutate(defaultStatus, { onError: () => (refocus.current = false) });
                }}
                title={t("detail.addAsDefault", { status: defaultLabel })}
                className={cn("flex min-w-0 flex-1 items-center gap-2 pl-3.5 pr-2 aria-disabled:opacity-60", ring)}
              >
                <Plus aria-hidden className="size-4 shrink-0" />
                <span className="truncate">{t("detail.addToList")}</span>
              </button>
              <span aria-hidden className="my-2 w-px shrink-0 bg-surface-600" />
            </>
          )}
          <button
            key="trigger"
            type="button"
            {...p}
            ref={(el) => {
              p.ref.current = el;
              trigger.current = el;
            }}
            disabled={!entry && add.isPending}
            aria-label={entry ? undefined : t("detail.chooseStatus")}
            title={entry ? t("actions.changeStatus") : t("detail.chooseStatus")}
            className={cn(
              ring,
              entry
                ? // The status as a tint with its dot, so the colour says which list and the ink stays the page's own.
                  cn("flex min-w-0 items-center justify-between gap-2 border px-3.5 font-semibold tint-fill text-ink-100 transition-surface", box)
                : "grid shrink-0 place-items-center px-2.5 text-ink-500 hover:text-ink-100",
            )}
            style={entry ? ({ "--tint": statusColorVar(entry.status) } as CSSProperties) : undefined}
          >
            {entry ? (
              <>
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: statusColorVar(entry.status) }} />
                  <span className="truncate">{t(`status.${media.type}.${entry.status}`)}</span>
                  {progressLabel && <span className="shrink-0 font-medium tabular-nums text-ink-300">{progressLabel}</span>}
                </span>
                <ChevronDown aria-hidden className="size-4 shrink-0 text-ink-500" />
              </>
            ) : (
              <ChevronDown aria-hidden className="size-4" />
            )}
          </button>
        </div>
      )}
    >
      {() => <QuickEditor media={media} entry={entry} defaultStatus={defaultStatus} onStatus={choose} onWrite={write} />}
    </Popover>
  );
}
