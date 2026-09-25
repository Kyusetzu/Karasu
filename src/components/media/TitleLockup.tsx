import { displayTitle, type MediaTitle } from "@/api/types";
import { cn } from "@/lib/utils";

/** A title and its native form stacked; the native line is dropped when it is the display title itself. */
export function TitleLockup({
  title,
  clamp = 1,
  tone = "primary",
  dense = false,
  className,
}: {
  title: MediaTitle;
  /** Lines the Latin title may occupy before it is clipped. */
  clamp?: 1 | 2;
  /** `muted` steps back a shade for captions under cover art, where the artwork already carries the identity. */
  tone?: "primary" | "muted";
  /** Sizes both lines from the density setting; the dense screens opt in, the list rows keep their fixed tracks. */
  dense?: boolean;
  className?: string;
}) {
  const latin = displayTitle(title);
  const native = title.native && title.native !== latin ? title.native : null;

  return (
    <div className={cn("min-w-0", className)}>
      <p
        className={cn(
          dense ? "dense-text-lg font-medium" : "text-ui font-medium",
          tone === "muted"
            ? "text-ink-300 group-hover:text-ink-100"
            : "text-ink-100",
          clamp === 2 ? "line-clamp-2" : "truncate",
        )}
      >
        {latin}
      </p>
      {native && (
        <p className={cn("truncate font-brand-jp text-ink-600", dense ? "dense-text" : "text-2xs")}>{native}</p>
      )}
    </div>
  );
}
