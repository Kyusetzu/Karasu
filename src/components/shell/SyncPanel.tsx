import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader } from "@/components/ui/loader";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CloudUpload, Hourglass, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { displayTitle, type ListResult, type QueuedEdit } from "@/api/types";
import { cn } from "@/lib/utils";
import { relTimeFromSeconds } from "@/lib/relTime";
import {
  isQueueField,
  queuedMediaId,
  syncPhase,
  type QueueField,
  type SyncPhase,
} from "@/lib/syncQueue";
import { usePresence } from "@/hooks/usePresence";
import { useBackClose } from "@/hooks/useBackClose";
import { useSyncStatus } from "@/hooks/useSyncStatus";
import { useManualSync } from "@/hooks/useManualSync";
import { Spinner } from "@/components/ui/spinner";

/** A literal `t()` per field, so `i18nKeys.test.ts` sees every key; the names are AniList's mutation arguments. */
export function fieldLabel(field: QueueField, t: (k: string) => string): string {
  switch (field) {
    case "status":
      return t("syncPanel.fieldStatus");
    case "progress":
      return t("syncPanel.fieldProgress");
    case "progressVolumes":
      return t("syncPanel.fieldVolumes");
    case "scoreRaw":
      return t("syncPanel.fieldScore");
    case "advancedScores":
      return t("syncPanel.fieldAdvanced");
    case "repeat":
      return t("syncPanel.fieldRepeat");
    case "notes":
      return t("syncPanel.fieldNotes");
    case "private":
      return t("syncPanel.fieldPrivate");
    case "hiddenFromStatusLists":
      return t("syncPanel.fieldHidden");
    case "customLists":
      return t("syncPanel.fieldCustomLists");
    case "startedAt":
      return t("syncPanel.fieldStarted");
    case "completedAt":
      return t("syncPanel.fieldCompleted");
  }
}

/** Same rule as `fieldLabel`: a literal `t()` per case, never an assembled key. */
function phaseLabel(phase: SyncPhase, t: (k: string) => string): string {
  switch (phase) {
    case "offline":
      return t("syncPanel.phaseOffline");
    case "draining":
      return t("syncPanel.phaseDraining");
    case "throttled":
      return t("syncPanel.phaseThrottled");
    case "waiting":
      return t("syncPanel.phaseWaiting");
    case "idle":
      return t("syncPanel.phaseIdle");
  }
}

/** What the sync is doing, on demand; nothing in it may cost an AniList request, since that budget is shared. */
export default function SyncPanel({
  label,
  children,
  className,
}: {
  /** Accessible name for the trigger. */
  label: string;
  /** What the trigger renders — the caller owns its content and layout. */
  children: ReactNode;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));
  const panel = usePresence(open);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const status = useSyncStatus(open);
  const manual = useManualSync();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Focus returns to the trigger on Escape only; after an outside click the user is already elsewhere.
      trigger.current?.focus();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Titles come from the cached lists only, never a request; an unfetched list's row simply goes unlabelled.
  const entries = qc
    .getQueriesData<ListResult>({ queryKey: ["mediaList"] })
    .flatMap(([, data]) => data?.lists.flatMap((g) => g.entries) ?? []);

  const data = status.data;
  const phase = data ? syncPhase(data) : null;
  const rate = data?.rate;
  const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

  const openEdit = (edit: QueuedEdit) => {
    const mediaId = queuedMediaId(edit, entries);
    if (mediaId == null) return;
    setOpen(false);
    navigate(`/media/${mediaId}`);
  };

  const row = (edit: QueuedEdit) => {
    const mediaId = queuedMediaId(edit, entries);
    const entry = entries.find((e) => e.mediaId === mediaId);
    const title = entry ? displayTitle(entry.media.title) : null;
    const fields = edit.fields
      .filter(isQueueField)
      .map((f) => fieldLabel(f, t))
      .join(", ");

    return (
      <li key={edit.id}>
        <button
          type="button"
          onClick={() => openEdit(edit)}
          disabled={mediaId == null}
          className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-surface hover:bg-surface-850 disabled:hover:bg-transparent"
        >
          <span
            className={cn(
              "mt-0.5 grid size-6 shrink-0 place-items-center rounded-inner",
              edit.kind === "delete"
                ? "bg-danger/14 text-danger"
                : "bg-accent-500/14 text-accent-400",
            )}
          >
            {edit.kind === "delete" ? (
              <Trash2 className="size-3.5" />
            ) : (
              <CloudUpload className="size-3.5" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui font-medium text-ink-100">
              {/* An unparsed payload is still a row, because the count here has to agree with the pending badge. */}
              {title ??
                (edit.subject == null
                  ? t("syncPanel.rowUnparsed")
                  : t("syncPanel.rowUntitled", { id: edit.subject }))}
            </span>
            <span className="mt-0.5 block truncate text-2xs text-ink-500">
              {edit.kind === "delete" ? t("syncPanel.rowDelete") : fields || t("syncPanel.rowSave")}
            </span>
          </span>
          <span className="mt-0.5 shrink-0 text-2xs text-ink-600">
            {relTimeFromSeconds(edit.queuedAt, i18n.language, t("notif.now"))}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div ref={wrap} className={cn("relative", className)}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="w-full rounded-control text-left transition-surface hover:bg-surface-900"
      >
        {children}
      </button>

      {panel.mounted && (
        <div
          role="dialog"
          aria-label={t("syncPanel.title")}
          // Owns the keyboard while up, exit included; not a focus trap, because trapping Tab in a popover is wrong.
          data-overlay
          className={cn(
            "absolute bottom-full left-0 z-50 mb-1 w-76 origin-bottom-left overflow-hidden rounded-panel border border-hair bg-surface-900 shadow-float panel-wash",
            panel.leaving ? "animate-pop-out" : "animate-spring-in",
          )}
        >
          <div className="flex items-center justify-between border-b border-hair px-3 py-2">
            <span className="text-2xs font-semibold uppercase text-ink-600">
              {t("syncPanel.title")}
            </span>
            {phase && (
              <span
                className={cn(
                  "flex items-center gap-1.25 text-2xs",
                  phase === "idle" ? "text-ink-500" : "text-accent-400",
                )}
              >
                {phase === "draining" && <Spinner className="size-2.75" />}
                {phase === "throttled" && <Hourglass className="size-2.75" />}
                {phaseLabel(phase, t)}
              </span>
            )}
          </div>

          {/* A failed status read is a state to render, not a reason to show the reassuring empty one. */}
          {status.error != null ? (
            <p className="px-3 py-4 text-xs text-danger">
              {t("common.error", { message: String(status.error) })}
            </p>
          ) : !data ? (
            <Loader size="sm" label={t("syncPanel.loading")} className="px-3 py-4" />
          ) : (
            <>
              <dl className="space-y-1.5 border-b border-hair px-3 py-2.5 text-2xs">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-600">{t("syncPanel.headroom")}</dt>
                  <dd className="tabular-nums text-ink-300">
                    {/* Null until a response header has been seen; the client's seed must never render as a measurement. */}
                    {rate?.remaining != null && rate.limit != null
                      ? t("syncPanel.headroomValue", {
                          left: rate.remaining,
                          limit: rate.limit,
                        })
                      : t("syncPanel.headroomUnknown")}
                  </dd>
                </div>
                {/* The reading's age, or an hours-old figure renders as live: the number only moves when a request lands. */}
                {rate?.observedAgoMs != null && (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-600">{t("syncPanel.measured")}</dt>
                    <dd className="tabular-nums text-ink-500">
                      {rate.observedAgoMs < 2_000
                        ? t("syncPanel.measuredNow")
                        : t("syncPanel.measuredAgo", {
                            s: Math.round(rate.observedAgoMs / 1000),
                          })}
                    </dd>
                  </div>
                )}
                {rate?.throttledForMs != null && (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-ink-600">{t("syncPanel.throttle")}</dt>
                    <dd className="tabular-nums text-accent-400">
                      {/* Says which wait this is: the app pacing itself, or a 429 the server asked it to sit out. */}
                      {rate.throttleKind === "retryAfter"
                        ? t("syncPanel.throttleLimited", {
                            s: seconds(rate.throttledForMs),
                          })
                        : t("syncPanel.throttlePacing", {
                            s: seconds(rate.throttledForMs),
                          })}
                    </dd>
                  </div>
                )}
              </dl>

              {data.queued.length === 0 ? (
                <p className="px-3 py-3 text-center text-xs text-ink-600">
                  {t("syncPanel.empty")}
                </p>
              ) : (
                <ul className="max-h-52 overflow-y-auto">{data.queued.map(row)}</ul>
              )}

              {/* The traffic, which is what moves the headroom while an idle app has nothing queued to list. */}
              <div className="border-t border-hair">
                <h3 className="px-3 pb-1 pt-2 text-2xs uppercase text-ink-600">
                  {t("syncPanel.recent")}
                </h3>
                {data.recent.length === 0 ? (
                  <p className="px-3 pb-3 text-2xs text-ink-600">
                    {t("syncPanel.recentEmpty")}
                  </p>
                ) : (
                  <ul className="max-h-44 overflow-y-auto pb-1">
                    {data.recent.map((r) => (
                      <li
                        key={r.seq}
                        className="flex items-baseline gap-2 px-3 py-1 text-2xs"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "size-1.25 shrink-0 rounded-full",
                            r.outcome === "ok"
                              ? "bg-success"
                              : r.outcome === "throttled"
                                ? "bg-gold"
                                : "bg-danger",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate text-ink-300">
                          {r.operation}
                        </span>
                        {/* Only when it waited; a column on every healthy row would bury the self-inflicted wait worth spotting. */}
                        {r.pacedMs > 0 && (
                          <span className="shrink-0 tabular-nums text-gold">
                            {t("syncPanel.paced", { ms: r.pacedMs })}
                          </span>
                        )}
                        <span className="shrink-0 tabular-nums text-ink-500">
                          {t("syncPanel.tookMs", { ms: r.durationMs })}
                        </span>
                        <span className="w-9 shrink-0 text-right tabular-nums text-ink-600">
                          {r.remainingAfter ?? "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Who spent the budget since the app started; the recent list above only shows the last fifty. */}
              <div className="border-t border-hair">
                <h3 className="px-3 pb-1 pt-2 text-2xs uppercase text-ink-600">
                  {t("syncPanel.sources")}
                </h3>
                {data.traffic.sources.length === 0 ? (
                  <p className="px-3 pb-3 text-2xs text-ink-600">{t("syncPanel.sourcesEmpty")}</p>
                ) : (
                  <ul className="max-h-36 overflow-y-auto pb-2">
                    {[...data.traffic.sources]
                      .sort((a, b) => b.total - a.total)
                      .map((s) => (
                        <li key={s.source} className="flex items-baseline gap-2 px-3 py-0.5 text-2xs">
                          <span className="min-w-0 flex-1 truncate text-ink-300">{s.source}</span>
                          <span className="shrink-0 tabular-nums text-ink-500">{s.total}</span>
                        </li>
                      ))}
                    {data.traffic.throttled > 0 && (
                      <li className="px-3 pt-1 text-2xs text-gold">
                        {t("syncPanel.throttled429", { n: data.traffic.throttled })}
                      </li>
                    )}
                  </ul>
                )}
              </div>

              {manual.available && (
                <div className="border-t border-hair p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void manual.sync()}
                    disabled={manual.syncing || data.draining}
                    className="w-full"
                  >
                    {t("sync.button")}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
