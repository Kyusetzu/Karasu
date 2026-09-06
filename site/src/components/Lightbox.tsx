import { useCallback, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Shot } from "@/content/screenshots";
import { cn } from "@/lib/cn";
import { usePresence } from "@/lib/usePresence";

/**
 * The screenshot viewer: one image at a time, captioned, with arrows, the
 * keyboard, and a swipe. A dialog that owns the keyboard while it is open —
 * `data-overlay`, as the app's overlays carry — and returns focus to the
 * thumbnail that opened it.
 */
export function Lightbox({
  shots,
  index,
  onClose,
  onIndex,
}: {
  shots: Shot[];
  /** null when closed */
  index: number | null;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const open = index !== null;
  const { mounted, leaving } = usePresence(open);
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const prev = useCallback(() => {
    if (index === null) return;
    onIndex((index - 1 + shots.length) % shots.length);
  }, [index, onIndex, shots.length]);
  const next = useCallback(() => {
    if (index === null) return;
    onIndex((index + 1) % shots.length);
  }, [index, onIndex, shots.length]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "Tab") {
        const items = Array.from(panel.current?.querySelectorAll<HTMLElement>("button") ?? []);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = "";
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose, prev, next]);

  if (!mounted || index === null) return null;
  const shot = shots[index];

  return (
    <div
      data-overlay
      role="dialog"
      aria-modal="true"
      aria-label={`Screenshot ${index + 1} of ${shots.length}: ${shot.caption}`}
      className={cn(
        "fixed inset-0 z-50 grid place-items-center bg-[rgba(4,5,8,.82)] p-4 md:p-8",
        leaving ? "animate-fade-out" : "animate-fade-in",
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onPointerDown={(e) => {
        if (e.pointerType === "touch") touch.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        if (!touch.current) return;
        const dx = e.clientX - touch.current.x;
        const dy = e.clientY - touch.current.y;
        touch.current = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
          if (dx < 0) next();
          else prev();
        }
      }}
    >
      <div
        ref={panel}
        className={cn(
          "relative flex max-h-full w-full max-w-6xl flex-col",
          leaving ? "animate-settle-out" : "animate-spring-in",
        )}
      >
        <figure className="min-h-0">
          <div className="panel-top overflow-hidden rounded-xl border border-surface-800 bg-surface-900 shadow-[0_1.5rem_4rem_rgba(0,0,0,.8)]">
            <img
              src={shot.src}
              width={shot.width}
              height={shot.height}
              alt={shot.alt}
              className="mx-auto block max-h-[78vh] w-auto max-w-full"
            />
          </div>
          <figcaption className="mt-3 flex items-center justify-between gap-4 text-sm text-ink-300">
            <span>{shot.caption}</span>
            <span className="shrink-0 text-2xs tabular-nums text-ink-600">
              {index + 1} / {shots.length}
            </span>
          </figcaption>
        </figure>
        <div className="absolute -top-2 right-0 flex -translate-y-full items-center gap-1 md:-right-2">
          <button
            type="button"
            onClick={prev}
            aria-label="Previous screenshot"
            className="grid size-9 place-items-center rounded-md text-ink-300 transition-surface hover:bg-surface-850 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent-500"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next screenshot"
            className="grid size-9 place-items-center rounded-md text-ink-300 transition-surface hover:bg-surface-850 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent-500"
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-md text-ink-300 transition-surface hover:bg-surface-850 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent-500"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
