import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useBackClose } from "@/hooks/useBackClose";
import { usePanZoom } from "@/hooks/usePanZoom";

/** The cover full screen on the modal primitives, not `<Modal>`; the src is one the caller already rendered. */
export default function CoverViewer({
  src,
  alt,
  onClose,
  leaving = false,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  /** On its way out — see `usePresence`. */
  leaving?: boolean;
}) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const pz = usePanZoom(panel, { minZoom: 1, maxZoom: 4 });
  useDialogFocus(panel, !leaving);
  useBackClose(!leaving, onClose);

  useEffect(() => {
    if (leaving) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, leaving]);

  return (
    <div
      ref={panel}
      // Kept while leaving — same contract as every overlay.
      data-overlay
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className={cn(
        // Keep `touch-none`; without it Chromium reclaims the drag with a pointercancel mid-gesture.
        "fixed inset-0 z-50 select-none overflow-hidden bg-[rgba(4,5,8,.92)] touch-none",
        leaving ? "animate-fade-out" : "animate-fade-in",
      )}
      {...pz.handlers}
      onClick={(e) => {
        if (leaving || pz.dragged()) return;
        // Anywhere but the picture or a control closes; a plain target check never matches the scrim through the wrapper.
        if ((e.target as HTMLElement).closest("img, button")) return;
        onClose();
      }}
      onDoubleClick={(e) => {
        if (leaving) return;
        const box = e.currentTarget.getBoundingClientRect();
        if (pz.zoom > 1) pz.reset();
        else pz.zoomAt(2, e.clientX - box.left, e.clientY - box.top);
      }}
    >
      <div
        className="h-full w-full will-change-transform"
        style={{
          transform: `translate3d(${pz.tx}px, ${pz.ty}px, 0) scale(${pz.zoom})`,
          transformOrigin: "0 0",
        }}
      >
        <div className="grid h-full w-full place-items-center p-6">
          <img
            src={src}
            alt={alt}
            draggable={false}
            className={cn(
              "max-h-full max-w-full rounded-lg object-contain shadow-[0_1.5rem_4rem_rgba(0,0,0,.8)]",
              leaving ? "animate-settle-out" : "animate-spring-in",
            )}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("window.close")}
        className="absolute right-4 top-4 grid size-9 place-items-center rounded-full bg-surface-900/80 text-ink-300 transition-surface hover:bg-surface-800 hover:text-ink-100"
      >
        <X className="size-4.5" />
      </button>
    </div>
  );
}
