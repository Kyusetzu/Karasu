import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import type { Action } from "@/lib/actions";
import { ACTION_ICON } from "@/components/shell/actionIcons";
import { useActionLabel } from "@/components/shell/actionLabels";
import { useBackClose } from "@/hooks/useBackClose";
import { cn } from "@/lib/utils";
import type { MediaType } from "@/api/types";

/** Menu geometry in rem; the class and the clamping maths read the same numbers, or the menu opens partly off-screen. */
const MENU_W_REM = 13.75;
const MENU_ROW_H_REM = 1.875;
/** A group boundary costs a rule plus its margins, and leaving it out of the clamp walks the menu off the bottom. */
const MENU_SEP_REM = 0.5;

const rootFontSize = () =>
  parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/** True where this row starts a new group, which is both where a rule is drawn and what the height maths counts. */
function dividesAt(actions: Action[], i: number): boolean {
  return i > 0 && actions[i].group !== actions[i - 1].group;
}

function menuHeightRem(actions: Action[]): number {
  const separators = actions.filter((_, i) => dividesAt(actions, i)).length;
  return actions.length * MENU_ROW_H_REM + separators * MENU_SEP_REM;
}

/** The pointer presentation of an action list: a flyout at the click, with one level of submenu and full keyboard use. */
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
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const subRows = useRef<(HTMLButtonElement | null)[]>([]);
  const [focus, setFocus] = useState(0);
  const [openSub, setOpenSub] = useState<number | null>(null);
  const [subFocus, setSubFocus] = useState(0);
  useBackClose(!leaving, onClose);

  const sub = openSub === null ? null : (actions[openSub]?.items ?? null);

  // Focus follows the cursor rather than the mouse, so arrowing and screen readers agree on where the menu is.
  useEffect(() => {
    if (leaving) return;
    if (sub) subRows.current[subFocus]?.focus();
    else rows.current[focus]?.focus();
  }, [focus, subFocus, sub, leaving]);

  useEffect(() => {
    if (leaving) return;
    const close = () => onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [leaving, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = sub ?? actions;
    const at = sub ? subFocus : focus;
    const move = (next: number) => {
      e.preventDefault();
      const clamped = Math.min(list.length - 1, Math.max(0, next));
      if (sub) setSubFocus(clamped);
      else setFocus(clamped);
    };
    switch (e.key) {
      case "ArrowDown":
        return move(at + 1);
      case "ArrowUp":
        return move(at - 1);
      case "Home":
        return move(0);
      case "End":
        return move(list.length - 1);
      case "ArrowRight":
        if (!sub && (actions[at].items?.length ?? 0) > 0) {
          e.preventDefault();
          setSubFocus(0);
          setOpenSub(at);
        }
        return;
      case "ArrowLeft":
        if (sub) {
          e.preventDefault();
          setOpenSub(null);
        }
        return;
      case "Escape":
        e.preventDefault();
        // One level at a time, so Escape never closes more than the reader can see it closing.
        if (sub) setOpenSub(null);
        else onClose();
        return;
      case "Enter":
      case " ": {
        e.preventDefault();
        const action = list[at];
        if (!sub && (action.items?.length ?? 0) > 0) {
          setSubFocus(0);
          setOpenSub(at);
        } else {
          onRun(action);
        }
        return;
      }
    }
  };

  const rem = rootFontSize();
  const gap = 0.5 * rem;
  const width = MENU_W_REM * rem;
  // Clamped at both ends: in a small window the right-and-bottom-only version could place the menu at a negative offset.
  const left = Math.max(gap, Math.min(x, window.innerWidth - width - gap));
  const top = Math.max(
    gap,
    Math.min(y, window.innerHeight - menuHeightRem(actions) * rem - gap),
  );
  const origin =
    top < y
      ? left < x
        ? "origin-bottom-right"
        : "origin-bottom-left"
      : left < x
        ? "origin-top-right"
        : "origin-top-left";

  // The flyout opens right unless the window has no room for a second panel, and carries its own top clamp.
  const subLeft = left + width + window.scrollX > window.innerWidth - gap ? left - width : left + width;
  const subTop = (index: number): number => {
    const above = actions.slice(0, index).filter((_, i) => dividesAt(actions, i)).length;
    const offset = (index * MENU_ROW_H_REM + above * MENU_SEP_REM) * rem;
    const height = menuHeightRem(sub ?? []) * rem;
    return Math.max(gap, Math.min(top + offset, window.innerHeight - height - gap));
  };

  const rowClass = (action: Action, active: boolean) =>
    cn(
      "flex h-7.5 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[.78125rem] transition-surface",
      action.danger
        ? "text-danger hover:bg-danger/10"
        : "text-ink-300 hover:bg-surface-800 hover:text-ink-100",
      active && (action.danger ? "bg-danger/10" : "bg-surface-800 text-ink-100"),
    );

  const panel =
    "overflow-hidden rounded-lg border border-hair bg-surface-850 p-1.25 shadow-2xl panel-wash";

  return (
    <div
      // Owns the keyboard while up, like every dialog, so a list shortcut cannot fire behind it.
      data-overlay
      onKeyDown={onKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        // A menu, announced as one, so a screen reader can say how many items there are and that they belong together.
        role="menu"
        aria-label={t("ctx.menuLabel")}
        className={cn(
          "fixed z-[100] w-55",
          panel,
          origin,
          leaving ? "animate-pop-out" : "animate-pop-in",
        )}
        style={{ left, top }}
      >
        {actions.map((action, i) => {
          const Icon = ACTION_ICON[action.id];
          const submenu = (action.items?.length ?? 0) > 0;
          return (
            <button
              key={`${action.id}-${i}`}
              role={submenu ? "menuitem" : "menuitem"}
              aria-haspopup={submenu || undefined}
              aria-expanded={submenu ? openSub === i : undefined}
              ref={(el) => {
                rows.current[i] = el;
              }}
              tabIndex={focus === i && !sub ? 0 : -1}
              onMouseEnter={() => {
                setFocus(i);
                setOpenSub(submenu ? i : null);
              }}
              onClick={() => (submenu ? (setSubFocus(0), setOpenSub(i)) : onRun(action))}
              className={cn(
                rowClass(action, focus === i && !sub),
                dividesAt(actions, i) && "mt-1 border-t border-surface-800 pt-1.5",
              )}
            >
              <span className="grid size-4 shrink-0 place-items-center text-ink-500">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate">{label(action, mediaType)}</span>
              {submenu && <ChevronRight className="size-3.5 shrink-0 text-ink-600" />}
            </button>
          );
        })}
      </div>

      {sub && openSub !== null && (
        <div
          role="menu"
          aria-label={label(actions[openSub], mediaType)}
          className={cn("fixed z-[100] w-55", panel, "animate-pop-in")}
          style={{ left: subLeft, top: subTop(openSub) }}
        >
          {sub.map((leaf, i) => (
            <button
              key={`${leaf.id}-${i}`}
              role="menuitem"
              ref={(el) => {
                subRows.current[i] = el;
              }}
              tabIndex={subFocus === i ? 0 : -1}
              onMouseEnter={() => setSubFocus(i)}
              onClick={() => onRun(leaf)}
              className={rowClass(leaf, subFocus === i)}
            >
              <span className="min-w-0 flex-1 truncate">{label(leaf, mediaType)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
