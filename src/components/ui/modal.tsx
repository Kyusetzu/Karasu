import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useBackClose } from "@/hooks/useBackClose";
import { Button } from "./button";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Width override — the default is the entry editor's `28rem`. */
  className?: string;
  /** On its way out: swaps the entrance for the exit, supplied by `usePresence` at the call site. */
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
  // One hook here covers every dialog in the app, because they all render through this component.
  useDialogFocus(panel, !leaving);
  // Once for every dialog, so the back gesture closes it; Escape and the backdrop must keep working on their own.
  useBackClose(!leaving, onClose);

  useEffect(() => {
    // Nothing to close once leaving; Escape during the exit would fire the parent's handler a second time.
    if (leaving) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, leaving]);

  return (
    <div
      // Kept while leaving, so a keypress mid-exit cannot act on the list behind a dialog the user can still see.
      data-overlay
      className={cn(
        "fixed inset-0 z-50 grid place-items-center bg-scrim p-4",
        leaving ? "animate-fade-out" : "animate-fade-in",
      )}
      onMouseDown={(e) =>
        !leaving && e.target === e.currentTarget && onClose()
      }
    >
      <div
        ref={panel}
        // The dialog semantics; `aria-modal` is the claim and `useDialogFocus` is what makes it true.
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "w-full max-w-md rounded-panel border border-hair bg-surface-900 p-5 shadow-float panel-wash",
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
