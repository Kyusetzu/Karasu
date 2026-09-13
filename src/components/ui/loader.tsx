import { cn } from "@/lib/utils";

/** The loader for a wait with no shape; `Skeleton` covers a known shape and a spinning `RefreshCw` a busy icon button. */
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
      {/* Keep the colour class on the animated element itself; WebKitGTK resolves inherited currentColor in filters stalely. */}
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
