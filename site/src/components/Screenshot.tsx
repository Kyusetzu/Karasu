import { cn } from "@/lib/cn";
import type { Shot } from "@/content/screenshots";

/** `srcset` for one format: "url 2880w, url 1440w". */
const srcset = (sources: Shot["avif"]) => sources.map((s) => `${s.src} ${s.w}w`).join(", ");

/**
 * One app screenshot in a window-like frame: the app's own border and the
 * catch-light along the top. A `<picture>` with AVIF and WebP at two widths
 * and a JPEG the `<img>` itself names; intrinsic dimensions always, so the
 * page never shifts while it loads; lazy unless the caller says it is above
 * the fold. `sizes` tells the browser how wide the frame renders, so a 1x
 * screen never downloads the 2x file.
 */
export function Screenshot({
  shot,
  className,
  priority = false,
  sizes = "(min-width: 1024px) 50vw, 100vw",
  onClick,
}: {
  shot: Shot;
  className?: string;
  priority?: boolean;
  sizes?: string;
  onClick?: () => void;
}) {
  const fallback = shot.jpg[0] ?? shot.webp[shot.webp.length - 1];
  const picture = (
    <picture>
      <source type="image/avif" srcSet={srcset(shot.avif)} sizes={sizes} />
      <source type="image/webp" srcSet={srcset(shot.webp)} sizes={sizes} />
      <img
        src={fallback.src}
        width={shot.width}
        height={shot.height}
        alt={shot.alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className="block h-auto w-full"
      />
    </picture>
  );
  const phone = shot.kind === "phone";
  const frame = cn(
    "panel-top overflow-hidden border border-surface-800 bg-surface-900 shadow-[0_1.25rem_2.5rem_rgba(0,0,0,.45)]",
    phone ? "rounded-[1.75rem]" : "rounded-xl",
    className,
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(frame, "shot-button group block w-full text-left hover:border-surface-700 focus-visible:outline-2 focus-visible:outline-accent-500")}
        aria-label={`Open: ${shot.caption}`}
      >
        {picture}
      </button>
    );
  }
  return <div className={frame}>{picture}</div>;
}
