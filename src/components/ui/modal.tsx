import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { Button } from "./button";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Width override — the default is the entry editor's `28rem`. */
  className?: string;
  /**
   * On its way out: swap the entrance for the exit. Supplied by `usePresence`
   * at the call site, which is what keeps this mounted long enough to be seen.
   * Omitted, the modal simply behaves as it always did.
   */
  leaving?: boolean;
}

export function Modal({
  title,
  onClose,
  children,
  className,
  leaving = false,
}: ModalProps) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // One hook here covers every dialog in the app, because they all render
  // through this component.
  useDialogFocus(panel, !leaving);

  useEffect(() => {
    // Nothing to close once it is already leaving — and Escape during the exit
    // would otherwise fire the parent's handler a second time.
    if (leaving) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, leaving]);

  return (
    <div
      // Kept while leaving: screen-level key handlers check for this, and
      // handing the keyboard back mid-exit would let a keypress act on the list
      // behind a dialog the user can still see.
      data-overlay
      className={cn(
        "fixed inset-0 z-50 grid place-items-center bg-[rgba(4,5,8,.55)] p-4",
        leaving ? "animate-fade-out" : "animate-fade-in",
      )}
      onMouseDown={(e) =>
        !leaving && e.target === e.currentTarget && onClose()
      }
    >
      <div
        ref={panel}
        // The semantics every dialog in Karasu was missing: without them a
        // screen reader announces this as an ordinary group of text, gives no
        // name for it, and does not tell the user that the rest of the page has
        // gone inert. `aria-modal` is the claim; `useDialogFocus` above is what
        // makes the claim true.
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "w-full max-w-md rounded-xl border border-hair bg-surface-900 p-5 shadow-2xl panel-wash",
          leaving ? "animate-settle-out" : "animate-spring-in",
          className,
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("window.close")}>
            <X className="size-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
