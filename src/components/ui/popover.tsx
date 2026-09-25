import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { usePresence } from "@/hooks/usePresence";
import { afterBackSettles, useBackClose } from "@/hooks/useBackClose";
import { useDialogFocus } from "@/hooks/useDialogFocus";
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
  const presence = usePresence(open);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
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

  // The sheet has its own backdrop; the dropdown closes on a press anywhere outside the trigger and the panel.
  useEffect(() => {
    if (!open || variant === "sheet") return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, variant]);

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

  // On the panel, bubbling: a dialog opened above it keeps its own Escape.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    triggerRef.current?.focus();
    setOpen(false);
  };

  const api: PopoverApi = { close, closeThen };
  const panel =
    variant === "sheet" ? (
      <Sheet open={open} id={id} label={label} onClose={close} className="p-4">
        {children(api)}
      </Sheet>
    ) : (
      presence.mounted && (
        <Panel id={id} label={label} align={align} width={width} leaving={presence.leaving} onKeyDown={onKeyDown}>
          {children(api)}
        </Panel>
      )
    );

  return (
    <div ref={boxRef} className={cn("relative inline-flex shrink-0", className)}>
      {renderTrigger({
        ref: triggerRef,
        onClick: toggle,
        "aria-expanded": open,
        "aria-haspopup": "dialog",
        "aria-controls": presence.mounted ? id : undefined,
      })}
      {panel}
    </div>
  );
}

/** Mounted only while shown, so the focus hook runs once per opening and restores to the trigger on the way out. */
function Panel({
  id,
  label,
  align,
  width,
  leaving,
  onKeyDown,
  children,
}: {
  id: string;
  label: string;
  align: "start" | "end";
  width: number;
  leaving: boolean;
  onKeyDown: (e: KeyboardEvent) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useDialogFocus(ref, !leaving);

  // A trigger near the window's edge would push its panel off screen; nudged back inside with a margin to spare.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const edge = 8;
    let dx = 0;
    if (r.right > window.innerWidth - edge) dx = window.innerWidth - edge - r.right;
    if (r.left + dx < edge) dx = edge - r.left;
    setShift(dx);
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label={label}
      data-overlay
      // Focusable by script and click only, so a press on the panel's text keeps Escape reaching it.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // `translate`, not `transform`, which the pop animation owns.
      style={{ width, translate: shift ? `${shift}px 0` : undefined }}
      className={cn(
        "absolute top-full z-50 mt-2 max-h-[min(70vh,34rem)] max-w-[calc(100vw-2rem)] overflow-y-auto outline-none",
        "rounded-panel border border-hair bg-surface-900 p-4 text-left shadow-float panel-wash",
        align === "end" ? "right-0" : "left-0",
        leaving ? "animate-pop-out" : "animate-pop-in",
      )}
    >
      {children}
    </div>
  );
}
