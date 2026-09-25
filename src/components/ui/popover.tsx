import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { afterBackSettles, useBackClose } from "@/hooks/useBackClose";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** What the trigger must carry: the toggle, its state for assistive tech, and the ref focus returns to. */
export interface PopoverTriggerProps {
  ref: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  "aria-expanded": boolean;
  "aria-haspopup": "dialog";
  "aria-controls"?: string;
}

export interface PopoverApi {
  close: () => void;
  /** Closes, hands focus back to the trigger, and runs `fn` once the panel's back entry has unwound. */
  closeThen: (fn: () => void) => void;
}

/** A dialog tied to a trigger: an anchored dropdown on the desktop, a bottom sheet on the phone; the caller picks. */
export function Popover({
  label,
  variant,
  align = "start",
  width = 360,
  renderTrigger,
  onOpen,
  onClosed,
  className,
  children,
}: {
  label: string;
  variant: "dropdown" | "sheet";
  align?: "start" | "end";
  /** The dropdown's width in px; the sheet always spans the screen. */
  width?: number;
  renderTrigger: (props: PopoverTriggerProps) => ReactNode;
  /** Runs before the panel's history entry is pushed, the last moment a caller may still write the URL itself. */
  onOpen?: () => void;
  /** Runs as the panel closes, before any `closeThen` action; a URL write from here must wait on `afterBackSettles`. */
  onClosed?: () => void;
  /** On the box around the trigger, for a trigger that has to grow with its row. */
  className?: string;
  children: (api: PopoverApi) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pending = useRef<(() => void) | null>(null);
  const wasOpen = useRef(false);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;

  // The sheet registers its own back entry through `Sheet`; the dropdown's is here.
  useBackClose(open && variant === "dropdown", () => setOpen(false));

  // After `useBackClose`'s cleanup has queued its unwinding `back()`, so a `closeThen` action waits for that popstate.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    closedRef.current?.();
    const then = pending.current;
    pending.current = null;
    if (then) afterBackSettles(then);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);
  const closeThen = useCallback((fn: () => void) => {
    pending.current = fn;
    // Before the panel unmounts, so a dialog opened by `fn` records the trigger as the place to return to.
    triggerRef.current?.focus();
    setOpen(false);
  }, []);

  // Closed on the press itself, before Base UI's click: a chip pressed outside must write after the panel, not before.
  useEffect(() => {
    if (!open || variant === "sheet") return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || document.getElementById(id)?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, variant, id]);

  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const toggle = () => {
    if (open) return setOpen(false);
    // Deferred, so a sibling closed by this same press has unwound its entry before this one is pushed.
    afterBackSettles(() => {
      openRef.current?.();
      setOpen(true);
    });
  };

  const api: PopoverApi = { close, closeThen };
  const panel =
    variant === "sheet" ? (
      <Sheet open={open} id={id} label={label} onClose={close} className="p-4">
        {children(api)}
      </Sheet>
    ) : (
      <BasePopover.Root
        open={open}
        onOpenChange={(next, details) => {
          // A press on the trigger is the trigger's own toggle, which would otherwise close and reopen the panel.
          const target = details.event?.target;
          if (details.reason === "outside-press" && target instanceof Node && triggerRef.current?.contains(target)) return;
          if (!next) setOpen(false);
        }}
      >
        <BasePopover.Portal>
          <BasePopover.Positioner
            anchor={triggerRef}
            side="bottom"
            align={align}
            sideOffset={8}
            collisionPadding={8}
            className="z-50"
          >
            {/* Owns the keyboard while up, exit included, so a list shortcut cannot fire behind it. */}
            <BasePopover.Popup
              id={id}
              aria-label={label}
              data-overlay
              finalFocus={triggerRef}
              style={{ width }}
              className={cn(
                "max-h-[min(var(--available-height),34rem)] max-w-[calc(100vw-2rem)] overflow-y-auto outline-none",
                "rounded-panel border border-hair bg-surface-900 p-4 text-left shadow-float panel-wash",
                "origin-(--transform-origin) data-open:animate-pop-in data-closed:animate-pop-out",
              )}
            >
              {children(api)}
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      </BasePopover.Root>
    );

  return (
    <div className={cn("relative inline-flex shrink-0", className)}>
      {renderTrigger({
        ref: triggerRef,
        onClick: toggle,
        "aria-expanded": open,
        "aria-haspopup": "dialog",
        "aria-controls": open ? id : undefined,
      })}
      {panel}
    </div>
  );
}
