import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ACTION_GROUP_ORDER, type Action, type ActionGroup } from "@/lib/actions";
import { ACTION_ICON } from "@/components/shell/actionIcons";
import { useActionLabel } from "@/components/shell/actionLabels";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useBackClose } from "@/hooks/useBackClose";
import { cn } from "@/lib/utils";
import type { MediaType } from "@/api/types";

/** The app chrome stays out: Back, Reload and Settings are a mouse menu's furniture, and the phone has its own bar. */
const SHEET_GROUPS: readonly ActionGroup[] = ["item", "edit", "detect", "link"];

/** The touch presentation of an action list: a bottom sheet with drill-down submenus, since a flyout needs a pointer. */
export default function ActionSheet({
  title,
  actions,
  mediaType,
  leaving = false,
  onRun,
  onClose,
}: {
  title: string | null;
  actions: Action[];
  mediaType: MediaType;
  /** On its way out — supplied by `Presence`. */
  leaving?: boolean;
  onRun: (action: Action) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const label = useActionLabel();
  const panel = useRef<HTMLDivElement>(null);
  const [drilled, setDrilled] = useState<Action | null>(null);
  useDialogFocus(panel, !leaving);
  // Back steps out of a submenu first, so the gesture unwinds the sheet the same way the eye came into it.
  useBackClose(!leaving, () => (drilled ? setDrilled(null) : onClose()));

  useEffect(() => {
    if (leaving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (drilled) setDrilled(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drilled, leaving, onClose]);

  const rows = drilled
    ? (drilled.items ?? [])
    : actions.filter((a) => SHEET_GROUPS.includes(a.group));

  return (
    <div
      // Kept while leaving, so a keypress on the last frame cannot reach the list behind the sheet.
      data-overlay
      className={cn(
        "fixed inset-0 z-[100]",
        leaving ? "animate-fade-out" : "animate-fade-in",
      )}
    >
      <button
        type="button"
        aria-label={t("window.close")}
        className="absolute inset-0 bg-[rgba(4,5,8,.55)]"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-label={t("actions.sheetLabel")}
        className={cn(
          // Clears the bottom bar and the gesture area; `max-h` plus scroll so a long list never hides its first row.
          "absolute inset-x-2 bottom-[calc(var(--shell-bottom,0px)+0.5rem)] max-h-[70vh] overflow-y-auto",
          // The sheet rises under a finger still held down, and Chromium's own long press would otherwise select its title.
          "select-none",
          "rounded-2xl border border-surface-700 bg-surface-900 p-2 shadow-[0_1rem_3rem_rgba(0,0,0,.6)]",
          leaving ? "animate-rise-out" : "animate-rise-in",
        )}
      >
        {drilled ? (
          <button
            type="button"
            onClick={() => setDrilled(null)}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm text-ink-400 transition-surface hover:bg-surface-850"
          >
            <ChevronLeft className="size-4 shrink-0" />
            <span className="truncate">{label(drilled, mediaType)}</span>
          </button>
        ) : (
          title && (
            <p className="truncate px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-600">
              {title}
            </p>
          )
        )}

        <div className="flex flex-col gap-0.5">
          {rows.map((action, i) => {
            const Icon = ACTION_ICON[action.id];
            const submenu = (action.items?.length ?? 0) > 0;
            // A separator wherever the group changes, which is the only structure the flat list carries.
            const divides =
              !drilled &&
              i > 0 &&
              ACTION_GROUP_ORDER.indexOf(action.group) !==
                ACTION_GROUP_ORDER.indexOf(rows[i - 1].group);
            return (
              <button
                key={`${action.id}-${action.arg ? JSON.stringify(action.arg) : i}`}
                type="button"
                onClick={() => (submenu ? setDrilled(action) : onRun(action))}
                className={cn(
                  // A comfortable touch target, not a scaled-down menu row.
                  "flex min-h-11 items-center gap-3 rounded-lg px-2 text-left text-sm transition-surface",
                  divides && "mt-1 border-t border-surface-800 pt-1.5",
                  action.danger
                    ? "text-danger hover:bg-danger/10"
                    : "text-ink-300 hover:bg-surface-850 hover:text-ink-100",
                )}
              >
                <span className="grid size-5 shrink-0 place-items-center text-ink-500">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">{label(action, mediaType)}</span>
                {submenu && <ChevronRight className="size-4 shrink-0 text-ink-600" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
