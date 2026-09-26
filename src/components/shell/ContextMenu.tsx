import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import type { Action } from "@/lib/actions";
import { ACTION_ICON } from "@/components/shell/actionIcons";
import { useActionLabel } from "@/components/shell/actionLabels";
import { Menu, MenuItem, MenuPanel, MenuSeparator, SubMenu } from "@/components/ui/menu";
import type { MediaType } from "@/api/types";

/** True where this row starts a new group, which is where a rule is drawn. */
function dividesAt(actions: Action[], i: number): boolean {
  return i > 0 && actions[i].group !== actions[i - 1].group;
}

/** The pointer presentation of an action list: a menu at the click, with one level of submenu and full keyboard use. */
export default function ContextMenu({
  x,
  y,
  actions,
  mediaType,
  leaving = false,
  onRun,
  onClose,
}: {
  x: number;
  y: number;
  actions: Action[];
  mediaType: MediaType;
  /** On its way out — supplied by `Presence`. */
  leaving?: boolean;
  onRun: (action: Action) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const label = useActionLabel();

  return (
    <Menu open={!leaving} onClose={onClose}>
      <MenuPanel anchor={{ x, y }} label={t("ctx.menuLabel")}>
        {actions.map((action, i) => {
          const Icon = ACTION_ICON[action.id];
          const text = label(action, mediaType);
          return (
            <Fragment key={`${action.id}-${i}`}>
              {dividesAt(actions, i) && <MenuSeparator />}
              {(action.items?.length ?? 0) > 0 ? (
                <SubMenu icon={Icon} title={text}>
                  {action.items!.map((leaf, j) => (
                    <MenuItem key={`${leaf.id}-${j}`} onSelect={() => onRun(leaf)}>
                      {label(leaf, mediaType)}
                    </MenuItem>
                  ))}
                </SubMenu>
              ) : (
                <MenuItem icon={Icon} danger={action.danger} onSelect={() => onRun(action)}>
                  {text}
                </MenuItem>
              )}
            </Fragment>
          );
        })}
      </MenuPanel>
    </Menu>
  );
}
