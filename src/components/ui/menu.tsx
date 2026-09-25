import type { ReactNode } from "react";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import type { LucideIcon } from "lucide-react";
import { useBackClose } from "@/hooks/useBackClose";
import { MenuRowBody, menuRowClass, menuSeparatorClass } from "@/components/ui/menu-row";
import { cn } from "@/lib/utils";

/** Where a menu opens: an element, or a point such as the pointer of a right-click. */
export type MenuAnchor = Element | { x: number; y: number };

const PANEL =
  "w-55 rounded-panel border border-hair bg-surface-900 p-1.25 shadow-float panel-wash outline-none origin-(--transform-origin) data-open:animate-pop-in data-closed:animate-pop-out";

/** A point as the zero-size box Floating UI positions against, so a menu can open where the pointer was. */
function toAnchor(anchor: MenuAnchor) {
  if (anchor instanceof Element) return anchor;
  const { x, y } = anchor;
  return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
}

/** A menu the caller opens and closes: always controlled, so the back gesture and `data-overlay` see every one. */
export function Menu({
  open,
  onClose,
  children,
}: {
  open: boolean;
  /** Called for a dismissal (Escape, outside press, back); choosing an item closes through the caller's own state. */
  onClose: () => void;
  children: ReactNode;
}) {
  useBackClose(open, onClose);
  // The context-menu root, because only it gives a menu with no trigger the tree node its submenus hang from.
  return (
    <BaseContextMenu.Root
      open={open}
      onOpenChange={(next, details) => {
        if (!next && details.reason !== "item-press") onClose();
      }}
    >
      {children}
    </BaseContextMenu.Root>
  );
}

/** The floating panel of a menu, placed against an anchor and kept on screen by flipping or shifting it. */
export function MenuPanel({
  anchor,
  label,
  side = "bottom",
  align = "start",
  className,
  children,
}: {
  anchor: MenuAnchor;
  /** The menu's accessible name. */
  label: string;
  side?: "top" | "bottom" | "inline-start" | "inline-end";
  align?: "start" | "center" | "end";
  className?: string;
  children: ReactNode;
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        anchor={toAnchor(anchor)}
        side={side}
        align={align}
        collisionPadding={8}
        positionMethod="fixed"
        className="z-popover"
      >
        {/* Owns the keyboard while up, exit included, so a list shortcut cannot fire behind it. */}
        <BaseMenu.Popup data-overlay aria-label={label} className={cn(PANEL, className)}>
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

/** One row of a menu; `label` is what typing a letter matches when the row's text is not plain. */
export function MenuItem({
  icon,
  danger = false,
  label,
  onSelect,
  children,
}: {
  icon?: LucideIcon;
  danger?: boolean;
  label?: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <BaseMenu.Item
      label={label}
      closeOnClick={false}
      onClick={onSelect}
      className={cn(menuRowClass({ size: "menu", danger, managed: true }), "cursor-default")}
    >
      <MenuRowBody size="menu" icon={icon} danger={danger}>
        {children}
      </MenuRowBody>
    </BaseMenu.Item>
  );
}

/** A rule between two groups of rows. */
export function MenuSeparator() {
  return <BaseMenu.Separator className={cn("-mx-1.25", menuSeparatorClass)} />;
}

/** A row that opens a second panel beside the first, with the pointer's safe path to it handled by Base UI. */
export function SubMenu({
  icon,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <BaseMenu.SubmenuRoot>
      <BaseMenu.SubmenuTrigger
        className={cn(menuRowClass({ size: "menu", managed: true }), "cursor-default data-popup-open:bg-surface-800")}
      >
        <MenuRowBody size="menu" icon={icon} chevron>
          {title}
        </MenuRowBody>
      </BaseMenu.SubmenuTrigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner collisionPadding={8} positionMethod="fixed" className="z-popover">
          <BaseMenu.Popup data-overlay aria-label={title} className={PANEL}>
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.SubmenuRoot>
  );
}
