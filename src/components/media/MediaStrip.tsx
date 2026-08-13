import { Link } from "react-router";
import type { PersonMediaEdge } from "@/api/social";
import { displayTitle } from "@/api/types";
import { isBlocked } from "@/lib/contentFilter";
import { useContentFilter } from "@/stores/contentFilter";
import { staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * A scrolling row of covers, each with an optional role caption.
 *
 * Shared by the character, staff and studio pages, which are the same shape with
 * a different word under each cover — `characterRole`, `staffRole`, or whether the
 * studio was the main one. Three copies of this would be three chances for the
 * grid to drift.
 *
 * The content filter runs here, as it does on the profile's favourites: none of
 * these connections take an `isAdult` argument, so client-side is the only place
 * it can happen.
 */
export function MediaStrip({ edges }: { edges: PersonMediaEdge[] }) {
  const level = useContentFilter((s) => s.level);
  const visible = edges.filter((e) => e.node && !isBlocked(e.node, level));
  if (!visible.length) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {visible.map((e, i) => {
        const role =
          e.characterRole ??
          e.staffRole ??
          (e.isMainStudio === true ? "main" : null);
        return (
          <Link
            key={`${e.node.id}-${i}`}
            to={`/media/${e.node.id}`}
            title={displayTitle(e.node.title)}
            className="group w-24 shrink-0 animate-rise-in"
            style={{ animationDelay: `${staggerDelay(i)}ms` }}
          >
            <div className="aspect-2/3 overflow-hidden rounded-lg bg-surface-850">
              {e.node.coverImage?.large && (
                <img
                  src={e.node.coverImage.large}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover transition-transform group-hover:scale-[1.03]"
                />
              )}
            </div>
            <p className="mt-1.5 line-clamp-2 text-2xs leading-snug text-ink-500 group-hover:text-ink-300">
              {displayTitle(e.node.title)}
            </p>
            {role && (
              <p
                className={cn(
                  "mt-0.5 truncate text-2xs",
                  role === "MAIN" || role === "main" ? "text-accent-400" : "text-ink-600",
                )}
                title={role}
              >
                {role.toLowerCase()}
              </p>
            )}
          </Link>
        );
      })}
    </div>
  );
}
