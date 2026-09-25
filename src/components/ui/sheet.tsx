import type { ReactNode, RefObject } from "react";
import { Drawer } from "@base-ui/react/drawer";
import { useBackClose } from "@/hooks/useBackClose";
import { cn } from "@/lib/utils";

/** How a sheet was dismissed, for a sheet whose Escape and back first step out of something inside it. */
export type SheetCloseReason = "escape" | "back" | "outside" | "swipe" | "other";

/** The phone's bottom sheet: dims the page, rises above the bottom bar, and goes down with a swipe, Escape or back. */
export function Sheet({
  open,
  id,
  onClose,
  label,
  initialFocus,
  tall = false,
  className,
  children,
}: {
  open: boolean;
  id?: string;
  /** Every dismissal comes here: the swipe, the dim, Escape and the back gesture. */
  onClose: (reason: SheetCloseReason) => void;
  /** The dialog's accessible name. */
  label: string;
  /** Where focus lands on open; by default the first control in the sheet. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Reaches to just under the top of the screen whatever it holds, for a list that is read rather than picked from. */
  tall?: boolean;
  className?: string;
  children: ReactNode;
}) {
  useBackClose(open, () => onClose("back"));
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        const reason = details.reason;
        onClose(reason === "escape-key" ? "escape" : reason === "outside-press" ? "outside" : reason === "swipe" ? "swipe" : "other");
      }}
    >
      <Drawer.Portal>
        <Drawer.Backdrop className="sheet-backdrop fixed inset-0 z-popover bg-scrim" />
        <Drawer.Viewport className="pointer-events-none fixed inset-0 z-popover">
          {/* Owns the keyboard while up, exit included, so a list shortcut cannot fire behind it. */}
          <Drawer.Popup
            id={id}
            data-overlay
            aria-label={label}
            initialFocus={initialFocus}
            className={cn(
              // Clears the bottom bar and the gesture area; `max-h` plus scroll so a long sheet never hides its top.
              "sheet-popup pointer-events-auto absolute inset-x-2 bottom-[calc(var(--shell-bottom,0px)+0.5rem)] max-h-[75vh] overflow-y-auto",
              "rounded-sheet border border-surface-700 bg-surface-900 p-3 shadow-sheet outline-none select-none",
              tall && "top-12 max-h-none",
              className,
            )}
          >
            <div aria-hidden className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-surface-700" />
            {children}
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
