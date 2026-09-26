import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePanZoom } from "@/hooks/usePanZoom";
import { IconButton } from "@/components/ui/icon-button";
import { Modal } from "@/components/ui/modal";

/** The cover full screen as a bare dialog; the src is one the caller already rendered. */
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
  const stage = useRef<HTMLDivElement>(null);
  const pz = usePanZoom(stage, { minZoom: 1, maxZoom: 4 });

  return (
    <Modal bare title={alt} onClose={onClose} leaving={leaving}>
      <div
        ref={stage}
        // Keep `touch-none`; without it Chromium reclaims the drag with a pointercancel mid-gesture.
        className="relative size-full select-none overflow-hidden touch-none"
        {...pz.handlers}
        onClick={(e) => {
          if (leaving || pz.dragged()) return;
          // Anywhere but the picture or a control closes; a plain target check never matches the dim through the wrapper.
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
                "max-h-full max-w-full rounded-control object-contain shadow-float",
                leaving ? "animate-settle-out" : "animate-spring-in",
              )}
            />
          </div>
        </div>
        <IconButton variant="onCover" round onClick={onClose} aria-label={t("window.close")} className="absolute right-4 top-4">
          <X className="size-4" />
        </IconButton>
      </div>
    </Modal>
  );
}
