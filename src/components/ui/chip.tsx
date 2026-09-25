import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChipTone = "neutral" | "muted" | "accent" | "gold" | "success" | "danger";
export type ChipSize = "xs" | "sm" | "md";

// Outlined on a clear ground, so coloured text keeps the contrast it was derived against on any surface.
const TONES: Record<ChipTone, string> = {
  neutral: "border-surface-700 text-ink-300",
  muted: "border-surface-700 text-ink-500",
  accent: "border-accent-500/45 text-accent-400",
  gold: "border-gold/45 text-gold",
  success: "border-success/45 text-success",
  danger: "border-danger/45 text-danger",
};

const SIZES: Record<ChipSize, string> = {
  xs: "h-4.5 gap-1 px-1.5 text-2xs",
  sm: "h-5.5 gap-1.5 px-2 text-xs",
  md: "h-6.5 gap-1.5 px-2.5 text-xs",
};

/** The classes of a chip, for the one that must be a link; everything else renders `Chip`. */
export function chipClass(tone: ChipTone = "neutral", size: ChipSize = "sm") {
  return cn(
    "inline-flex max-w-full shrink-0 items-center whitespace-nowrap rounded-inner border",
    SIZES[size],
    TONES[tone],
  );
}

/** A small label for a fact about something: a genre, a tag, a category, a state. */
export function Chip({
  tone,
  size,
  icon: Icon,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone; size?: ChipSize; icon?: LucideIcon }) {
  return (
    <span className={cn(chipClass(tone, size), className)} {...rest}>
      {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A chip the user can take away: the whole chip is the button, named by `removeLabel`, with the cross as its sign. */
export function RemovableChip({
  tone = "accent",
  size = "md",
  icon: Icon,
  removeLabel,
  onRemove,
  className,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  tone?: ChipTone;
  size?: ChipSize;
  icon?: LucideIcon;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={removeLabel}
      onClick={onRemove}
      className={cn(
        chipClass(tone, size),
        "relative press coarse:hit-area pr-1.5 transition-surface hover:bg-surface-850",
        className,
      )}
      {...rest}
    >
      {Icon && <Icon aria-hidden className="size-3.5 shrink-0 text-ink-500" />}
      <span className="truncate text-ink-100">{children}</span>
      <X aria-hidden className="size-3.5 shrink-0 text-ink-500" />
    </button>
  );
}
