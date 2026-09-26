import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** `menu` is the dense row at the pointer, `panel` a dropdown's or a sheet's, `touch` a sheet only a finger opens. */
export type MenuRowSize = "menu" | "panel" | "touch";

export interface MenuRowStyle {
  size?: MenuRowSize;
  danger?: boolean;
  /** The row that is already chosen: the page you are on, the sort in force. */
  current?: boolean;
  /** The highlight comes from `data-highlighted`, set by Base UI or by a list that keeps its own cursor. */
  managed?: boolean;
}

const BASE = "flex w-full items-center text-left transition-surface select-none";

// A coarse pointer gets the finger's row in every size; a fine one keeps the dense rows it can hit.
const SIZES: Record<MenuRowSize, string> = {
  menu: "min-h-7.5 gap-2.5 rounded-inner px-2.5 text-ui coarse:min-h-11",
  panel: "min-h-9 gap-2.5 rounded-control px-2.5 py-1.5 text-ui coarse:min-h-11 coarse:text-sm",
  touch: "min-h-11 gap-2.5 rounded-control px-2.5 py-1.5 text-sm",
};

/** The classes of a row, for one whose element is not a button: a router link, a radio's label, a Base UI item. */
export function menuRowClass({ size = "panel", danger = false, current = false, managed = false }: MenuRowStyle = {}) {
  // A managed highlight is the keyboard's place, so it takes the stronger step a hover does not need.
  const highlight = managed
    ? danger
      ? "data-highlighted:bg-danger/10"
      : "data-highlighted:bg-surface-800 data-highlighted:text-ink-100"
    : danger
      ? "hover:bg-danger/10"
      : "hover:bg-surface-850 hover:text-ink-100";
  return cn(
    BASE,
    SIZES[size],
    // A managed list's pointer is not its cursor, so high contrast rings only the highlighted row there.
    managed ? "menu-row-edge-managed outline-none" : "menu-row-edge",
    danger ? "text-danger" : current ? "bg-surface-800 text-ink-100" : "text-ink-300",
    !current && highlight,
  );
}


/** What sits inside a row: an icon column, the label that truncates, then a trailing note or a chevron. */
export function MenuRowBody({
  size = "panel",
  icon: Icon,
  lead,
  danger = false,
  current = false,
  trailing,
  chevron = false,
  children,
}: {
  size?: MenuRowSize;
  icon?: LucideIcon;
  /** Stands where the icon would, for a row led by something else: a cover, a check. */
  lead?: ReactNode;
  danger?: boolean;
  current?: boolean;
  trailing?: ReactNode;
  /** The row opens something further: a submenu, a drill-in. */
  chevron?: boolean;
  children: ReactNode;
}) {
  const glyph = size === "menu" ? "size-3.5" : "size-4";
  return (
    <>
      {Icon ? (
        <span
          className={cn(
            "grid size-4 shrink-0 place-items-center",
            danger ? "text-danger" : current ? "text-accent-400" : "text-ink-500",
          )}
        >
          <Icon aria-hidden className={glyph} />
        </span>
      ) : (
        lead
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {/* A flex row drops the space from layout, and it keeps a screen reader from running label and note together. */}
      {trailing && <> {trailing}</>}
      {chevron && <ChevronRight aria-hidden className={cn(glyph, "shrink-0 text-ink-600")} />}
    </>
  );
}

/** A row that is a button: a sheet's action, a panel's choice. */
export function MenuRow({
  size,
  danger,
  current,
  icon,
  lead,
  trailing,
  chevron,
  className,
  children,
  ...rest
}: MenuRowStyle &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    icon?: LucideIcon;
    lead?: ReactNode;
    trailing?: ReactNode;
    chevron?: boolean;
    children: ReactNode;
  }) {
  return (
    <button
      type="button"
      {...rest}
      // Marks the chosen row for high contrast, which cannot see a tonal step.
      data-current={current || undefined}
      className={cn(menuRowClass({ size, danger, current }), className)}
    >
      <MenuRowBody size={size} icon={icon} lead={lead} danger={danger} current={current} trailing={trailing} chevron={chevron}>
        {children}
      </MenuRowBody>
    </button>
  );
}

/** A trailing note on a row, such as the tab a preset opens. */
export function MenuRowNote({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-2xs text-ink-600">{children}</span>;
}

/** The rule between two groups of rows. */
export const menuSeparatorClass = "my-1 border-t border-hair";

export function MenuRowSeparator() {
  return <div role="separator" className={menuSeparatorClass} />;
}

/** The small caps over a group of rows, or over a sheet that names what it acts on. */
export function MenuGroupLabel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn("truncate px-2.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-eyebrow text-ink-600", className)}
    />
  );
}
