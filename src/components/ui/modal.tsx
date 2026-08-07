import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
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
        className={cn(
          "w-full max-w-md rounded-xl border border-hair bg-surface-900 p-5 shadow-2xl panel-wash",
          leaving ? "animate-settle-out" : "animate-spring-in",
          className,
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("window.close")}>
            <X className="size-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
