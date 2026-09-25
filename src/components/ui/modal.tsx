import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useBackClose } from "@/hooks/useBackClose";
import { Button } from "./button";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl";

const SIZES: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
};

interface ModalProps {
  title: string;
  onClose: () => void;
  children?: ReactNode;
  /** The panel's widest; `md`, the entry editor's, unless the content asks for more. */
  size?: ModalSize;
  /** Extra classes on the panel, after the size. */
  className?: string;
  /** The body's classes, for a dialog that lays out its own scrolling region. */
  bodyClassName?: string;
  /** A line under the title: the evidence the choice is about. */
  description?: ReactNode;
  /** Before the title, such as an alert's warning tile. */
  icon?: ReactNode;
  /** The dialog's buttons, pinned under the body so a long form never scrolls them away. */
  footer?: ReactNode;
  /** It interrupts: `alertdialog`, above every other dialog, and no close button, since its buttons are the answer. */
  alert?: boolean;
  /** No panel and no header: the children are the whole screen over a deeper dim, and the title only names it. */
  bare?: boolean;
  /** False while something runs that must not be left half done: the X goes and Escape, the dim and back stand down. */
  dismissable?: boolean;
  /** On its way out: swaps the entrance for the exit, supplied by `usePresence` at the call site. */
  leaving?: boolean;
}

/** Every dialog in the app: a titled panel over a dim, or with `bare` a full-screen view; focus, Escape and back included. */
export function Modal({
  title,
  onClose,
  children,
  size = "md",
  className,
  bodyClassName,
  description,
  icon,
  footer,
  alert = false,
  bare = false,
  dismissable = true,
  leaving = false,
}: ModalProps) {
  const { t } = useTranslation();
  const scrim = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const live = !leaving && dismissable;
  const hasBody = children != null && children !== false;
  // One hook here covers every dialog in the app, because they all render through this component.
  useDialogFocus(panel, !leaving);
  // The entry stays while it may not be closed, so back is absorbed rather than falling through to the page behind.
  useBackClose(!leaving, () => dismissable && onClose());

  useEffect(() => {
    // Nothing to close once leaving; Escape during the exit would fire the parent's handler a second time.
    if (!live) return;
    const onKey = (e: KeyboardEvent) => {
      // A control that answered the press itself, such as a search field emptying, has spent it.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Only the overlay holding focus answers, so Escape in a dialog over a dialog, or a menu in one, closes one thing.
      const owner = (document.activeElement as HTMLElement | null)?.closest?.("[data-overlay]");
      if (owner && owner !== scrim.current) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, live]);

  return (
    <div
      ref={scrim}
      // Kept while leaving, so a keypress mid-exit cannot act on the list behind a dialog the user can still see.
      data-overlay
      className={cn(
        "fixed inset-0",
        alert ? "z-alert" : "z-50",
        bare ? "bg-scrim-deep" : "flex items-center justify-center bg-scrim p-4",
        leaving ? "animate-fade-out" : "animate-fade-in",
      )}
      onMouseDown={(e) => live && e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        // `alertdialog` tells a screen reader to interrupt rather than wait its turn; `aria-modal` is made true by the trap.
        role={alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={bare ? undefined : titleId}
        aria-label={bare ? title : undefined}
        aria-describedby={alert && hasBody ? bodyId : undefined}
        className={
          bare
            ? cn("size-full", className)
            : cn(
                "flex max-h-full w-full flex-col rounded-panel border border-hair bg-surface-900 shadow-float panel-wash",
                SIZES[size],
                leaving ? "animate-settle-out" : "animate-spring-in",
                className,
              )
        }
      >
        {bare ? (
          children
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-3 px-5 pt-5">
              {icon}
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-base font-semibold text-ink-100">
                  {title}
                </h2>
                {description && <div className="mt-0.5 truncate text-2xs text-ink-600">{description}</div>}
              </div>
              {!alert && dismissable && (
                <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("window.close")}>
                  <X className="size-4" />
                </Button>
              )}
            </div>
            {hasBody && (
              <div id={bodyId} className={cn("min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4", bodyClassName)}>
                {children}
              </div>
            )}
            {footer && (
              <div
                className={cn(
                  "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-hair px-5 py-3",
                  !hasBody && "mt-4",
                )}
              >
                {footer}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
