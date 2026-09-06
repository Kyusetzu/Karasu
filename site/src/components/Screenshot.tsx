import { cn } from "@/lib/cn";
import type { Shot } from "@/content/screenshots";

/**
 * One app screenshot in a window-like frame: the app's own border and the
 * catch-light along the top. Intrinsic dimensions always, so the page never
 * shifts while it loads; lazy unless the caller says it is above the fold.
 */
export function Screenshot({
  shot,
  className,
  priority = false,
  onClick,
}: {
  shot: Shot;
  className?: string;
  priority?: boolean;
  onClick?: () => void;
}) {
  const img = (
    <img
      src={shot.src}
      width={shot.width}
      height={shot.height}
      alt={shot.alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className="block h-auto w-full"
    />
  );
  const frame = cn(
    "panel-top overflow-hidden rounded-xl border border-surface-800 bg-surface-900 shadow-[0_1.25rem_2.5rem_rgba(0,0,0,.45)]",
    className,
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(frame, "group block w-full text-left transition-surface hover:border-surface-700 focus-visible:outline-2 focus-visible:outline-accent-500")}
        aria-label={`Open: ${shot.caption}`}
      >
        {img}
      </button>
    );
  }
  return <div className={frame}>{img}</div>;
}
