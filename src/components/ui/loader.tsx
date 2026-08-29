import { cn } from "@/lib/utils";

/**
 * The chevron loader — for indeterminate work with no shape.
 *
 * The app now has three loading vocabularies, on purpose, and this header is
 * where the split is written down so a fourth does not appear by accident:
 * `Skeleton` where the incoming content's *shape* is known (grids, detail
 * pages — the placeholder promises a layout); this loader where the wait has
 * no shape at all (a page still computing, a sync read, a search in flight);
 * and the spinning `RefreshCw` as the busy state of an icon button that
 * already shows that icon at rest.
 *
 * A `role="status"` live region with the visible caption *inside* it — the
 * Toast/SessionExpired precedent — because an empty labelled div is announced
 * unreliably; the chevrons themselves are `aria-hidden` decoration. The
 * animation is pure CSS (`loader-sweep` in index.css), so the reduced-motion
 * collapse reaches it and freezes it fully revealed.
 */
export function Loader({
  label,
  size = "md",
  className,
}: {
  /** The visible caption, and what a screen reader announces. */
  label: string;
  /** `md` for a page-level wait, `sm` for popovers and tight rows. */
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn("flex flex-col items-start gap-2.5", className)}
    >
      {/* The colour class sits on the animated element itself rather than
          being inherited — see the WebKitGTK note beside the utility. */}
      <span
        aria-hidden
        className={cn(
          "loader-sweep text-accent-400",
          size === "md" ? "text-[1.125rem]" : "text-[.6875rem]",
        )}
      />
      <p className={cn("text-ink-500", size === "md" ? "text-sm" : "text-xs")}>
        {label}
      </p>
    </div>
  );
}
