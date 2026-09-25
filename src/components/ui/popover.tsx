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
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { usePresence } from "@/hooks/usePresence";
import { afterBackSettles, useBackClose } from "@/hooks/useBackClose";
import { useDialogFocus } from "@/hooks/useDialogFocus";
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

  useBackClose(open, () => setOpen(false));

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
  const panel = presence.mounted && (
    <Panel
      id={id}
      label={label}
      variant={variant}
      align={align}
      width={width}
      leaving={presence.leaving}
      onKeyDown={onKeyDown}
      onClose={close}
    >
      {children(api)}
    </Panel>
  );

  return (
    <div ref={boxRef} className="relative inline-flex shrink-0">
      {renderTrigger({
        ref: triggerRef,
        onClick: toggle,
        "aria-expanded": open,
        "aria-haspopup": "dialog",
        "aria-controls": presence.mounted ? id : undefined,
      })}
      {variant === "sheet" && panel ? createPortal(panel, document.body) : panel}
    </div>
  );
}

/** Mounted only while shown, so the focus hook runs once per opening and restores to the trigger on the way out. */
function Panel({
  id,
  label,
  variant,
  align,
  width,
  leaving,
  onKeyDown,
  onClose,
  children,
}: {
  id: string;
  label: string;
  variant: "dropdown" | "sheet";
  align: "start" | "end";
  width: number;
  leaving: boolean;
  onKeyDown: (e: KeyboardEvent) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useDialogFocus(ref, !leaving);

  // A trigger near the window's edge would push its panel off screen; nudged back inside with a margin to spare.
  useLayoutEffect(() => {
    if (variant !== "dropdown" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const edge = 8;
    let dx = 0;
    if (r.right > window.innerWidth - edge) dx = window.innerWidth - edge - r.right;
    if (r.left + dx < edge) dx = edge - r.left;
    setShift(dx);
  }, [variant]);

  if (variant === "dropdown") {
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
          "rounded-xl border border-hair bg-surface-900 p-4 text-left shadow-2xl panel-wash",
          align === "end" ? "right-0" : "left-0",
          leaving ? "animate-pop-out" : "animate-pop-in",
        )}
      >
        {children}
      </div>
    );
  }

  return (
    // Kept while leaving, so a keypress on the last frame cannot reach the list behind the sheet.
    <div data-overlay className={cn("fixed inset-0 z-[100]", leaving ? "animate-fade-out" : "animate-fade-in")}>
      <button
        type="button"
        aria-label={t("window.close")}
        className="absolute inset-0 bg-[rgba(4,5,8,.55)]"
        onClick={onClose}
      />
      <div
        ref={ref}
        id={id}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          // Clears the bottom bar and the gesture area; `max-h` plus scroll so a long panel never hides its top.
          "absolute inset-x-2 bottom-[calc(var(--shell-bottom,0px)+0.5rem)] max-h-[75vh] overflow-y-auto outline-none",
          "rounded-2xl border border-surface-700 bg-surface-900 p-4 shadow-[0_1rem_3rem_rgba(0,0,0,.6)]",
          leaving ? "animate-rise-out" : "animate-rise-in",
        )}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-surface-700" />
        {children}
      </div>
    </div>
  );
}
