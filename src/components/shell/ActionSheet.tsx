import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ACTION_GROUP_ORDER, type Action, type ActionGroup } from "@/lib/actions";
import { ACTION_ICON } from "@/components/shell/actionIcons";
import { useActionLabel } from "@/components/shell/actionLabels";
import { Sheet } from "@/components/ui/sheet";
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
  const [drilled, setDrilled] = useState<Action | null>(null);

  const rows = drilled
    ? (drilled.items ?? [])
    : actions.filter((a) => SHEET_GROUPS.includes(a.group));

  return (
    <Sheet
      open={!leaving}
      label={t("actions.sheetLabel")}
      // Escape and back step out of a submenu first, so they unwind the sheet the way the eye came into it.
      onClose={(reason) => (drilled && (reason === "escape" || reason === "back") ? setDrilled(null) : onClose())}
      className="p-2"
    >
      {drilled ? (
        <button
          type="button"
          onClick={() => setDrilled(null)}
          className="flex min-h-11 w-full items-center gap-2.5 rounded-control px-2 text-left text-sm text-ink-300 transition-surface hover:bg-surface-850"
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
                "flex min-h-11 items-center gap-3 rounded-control px-2 text-left text-sm transition-surface",
                divides && "mt-1 border-t border-hair pt-1.5",
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
    </Sheet>
  );
}
