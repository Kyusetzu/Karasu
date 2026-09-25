import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";
import { ACTION_GROUP_ORDER, type Action, type ActionGroup } from "@/lib/actions";
import { ACTION_ICON } from "@/components/shell/actionIcons";
import { useActionLabel } from "@/components/shell/actionLabels";
import { MenuGroupLabel, MenuRow, MenuRowSeparator } from "@/components/ui/menu-row";
import { Sheet } from "@/components/ui/sheet";
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
        <MenuRow size="touch" icon={ChevronLeft} onClick={() => setDrilled(null)}>
          {label(drilled, mediaType)}
        </MenuRow>
      ) : (
        title && <MenuGroupLabel>{title}</MenuGroupLabel>
      )}

      <div className="flex flex-col gap-0.5">
        {rows.map((action, i) => {
          const submenu = (action.items?.length ?? 0) > 0;
          // A rule wherever the group changes, which is the only structure the flat list carries.
          const divides =
            !drilled &&
            i > 0 &&
            ACTION_GROUP_ORDER.indexOf(action.group) !==
              ACTION_GROUP_ORDER.indexOf(rows[i - 1].group);
          return (
            <Fragment key={`${action.id}-${action.arg ? JSON.stringify(action.arg) : i}`}>
              {divides && <MenuRowSeparator />}
              <MenuRow
                // Only a finger opens this sheet, so its rows are the finger's size on any device.
                size="touch"
                icon={ACTION_ICON[action.id]}
                danger={action.danger}
                chevron={submenu}
                onClick={() => (submenu ? setDrilled(action) : onRun(action))}
              >
                {label(action, mediaType)}
              </MenuRow>
            </Fragment>
          );
        })}
      </div>
    </Sheet>
  );
}
