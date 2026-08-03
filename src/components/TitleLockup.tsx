import { displayTitle, type MediaTitle } from "@/api/types";
import { cn } from "@/lib/utils";

/**
 * A title and its native form, stacked.
 *
 * The native line is dropped when it *is* the display title, which is the
 * common case for anything with no English or romaji entry — repeating it
 * would just double the row height for nothing. It is set in Kosugi Maru,
 * which is the only place the app's Japanese face appears in list content.
 */
export function TitleLockup({
  title,
  clamp = 1,
  className,
}: {
  title: MediaTitle;
  /** Lines the Latin title may occupy before it is clipped. */
  clamp?: 1 | 2;
  className?: string;
}) {
  const latin = displayTitle(title);
  const native = title.native && title.native !== latin ? title.native : null;

  return (
    <div className={cn("min-w-0", className)}>
      <p
        className={cn(
          "text-[.8125rem] font-medium text-ink-100",
          clamp === 2 ? "line-clamp-2" : "truncate",
        )}
      >
        {latin}
      </p>
      {native && (
        <p className="truncate font-brand-jp text-2xs text-ink-600">{native}</p>
      )}
    </div>
  );
}
