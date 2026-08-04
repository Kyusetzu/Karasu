import { tagsOf } from "@/lib/tags";
import { cn } from "@/lib/utils";

/** Read-only tag chips derived from an entry's notes (capped for layout). */
export function TagChips({
  notes,
  max = 3,
  className,
}: {
  notes: string | null;
  max?: number;
  className?: string;
}) {
  const tags = tagsOf(notes);
  // Still occupies its column when empty — a row whose neighbours shift left
  // because it happens to have no tags is harder to scan than a gap.
  if (tags.length === 0) return className ? <div className={className} /> : null;
  return (
    <div className={cn("mt-1 flex flex-wrap gap-1", className)}>
      {tags.slice(0, max).map((tag) => (
        <span
          key={tag}
          className="rounded-[.625rem] border border-surface-800 bg-surface-850 px-1.25 py-px text-2xs text-accent-400"
        >
          {tag}
        </span>
      ))}
      {tags.length > max && (
        <span className="text-2xs text-ink-600">+{tags.length - max}</span>
      )}
    </div>
  );
}
