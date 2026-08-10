import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { initialFor } from "@/lib/initials";

/**
 * A user's avatar, and the avatar plus their name.
 *
 * Three screens had drawn this by hand at three sizes — the sidebar's account
 * block, the statistics header and the account settings pane — and the social
 * screens need it at three more, in lists of fifty. Two exports rather than one
 * because the shared part is only the *disc*: the statistics header's text side
 * is a page title with a chart icon for a fallback, not a name, so forcing it
 * through a name/sub stack would be the wrong shape for the sake of one import.
 *
 * Not used by `stats/RankedList`, which draws voice-actor portraits with a
 * three-state `undefined | null | string` (no column / no portrait / portrait).
 * That is a different thing wearing the same border-radius.
 */

export type AvatarSize = "sm" | "md" | "lg" | "xl" | "2xl";

/** Written out rather than interpolated — Tailwind scans source for literals. */
const DISC: Record<AvatarSize, string> = {
  sm: "size-7",
  md: "size-9",
  lg: "size-12",
  xl: "size-14",
  "2xl": "size-20",
};

const INITIAL_TEXT: Record<AvatarSize, string> = {
  sm: "text-[.6875rem]",
  md: "text-xs",
  lg: "text-base",
  xl: "text-lg",
  "2xl": "text-2xl",
};

const GAP: Record<AvatarSize, string> = {
  sm: "gap-2.5",
  md: "gap-2.5",
  lg: "gap-4",
  xl: "gap-4",
  "2xl": "gap-5",
};

interface AvatarProps {
  src?: string | null;
  /** Supplies the initial when there is no image, so pass it even with one. */
  name?: string;
  size?: AvatarSize;
  /** Shown instead of an initial when there is no image — an icon, usually. */
  fallback?: ReactNode;
  className?: string;
}

export function Avatar({ src, name, size = "md", fallback, className }: AvatarProps) {
  const disc = cn(DISC[size], "shrink-0 rounded-full", className);

  // `alt=""` on purpose: every call site renders the name next to the disc, so
  // a screen reader that announced it too would read the name twice.
  if (src) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn(disc, "object-cover")}
      />
    );
  }

  if (fallback) {
    return (
      <span className={cn(disc, "grid place-items-center bg-surface-800 text-accent-400")}>
        {fallback}
      </span>
    );
  }

  return (
    <span
      className={cn(
        disc,
        "avatar-wash grid place-items-center bg-surface-800 font-semibold text-ink-300",
        INITIAL_TEXT[size],
      )}
    >
      {initialFor(name ?? "")}
    </span>
  );
}

interface UserLockupProps extends AvatarProps {
  name: string;
  /** The second line — a relative time, a follow relation, a link. */
  sub?: ReactNode;
  /** Overrides the name's own styling; the sidebar wants it smaller and dimmer. */
  nameClassName?: string;
  /** Wraps the name so a truncated one is still readable on hover. */
  titleAttr?: boolean;
  className?: string;
}

export function UserLockup({
  name,
  sub,
  size = "md",
  nameClassName,
  titleAttr,
  className,
  ...avatar
}: UserLockupProps) {
  return (
    <div className={cn("flex items-center", GAP[size], className)}>
      <Avatar {...avatar} name={name} size={size} />
      <div className="min-w-0 flex-1">
        <span
          className={cn("block truncate font-semibold text-ink-100", nameClassName)}
          title={titleAttr ? name : undefined}
        >
          {name}
        </span>
        {sub}
      </div>
    </div>
  );
}
