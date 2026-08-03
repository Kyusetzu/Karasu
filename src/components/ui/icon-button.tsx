import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const iconButtonVariants = cva(
  "grid shrink-0 place-items-center transition-surface focus-visible:outline-2 focus-visible:outline-accent-500 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        ghost: "text-ink-500 hover:bg-surface-850 hover:text-ink-100",
        surface: "bg-surface-800 text-ink-300 hover:bg-surface-700 hover:text-ink-100",
        accent: "bg-accent-500 text-accent-ink hover:bg-accent-600",
        /** For the action circles that sit *on* cover art, where the artwork
            beneath is unpredictable and the fill has to be near-opaque. */
        onCover: "bg-[rgba(4,5,8,.86)] text-ink-300 border border-surface-700 hover:text-ink-100",
        success: "text-success hover:bg-success/10",
        danger: "text-danger hover:bg-danger/10",
      },
      size: {
        /** 2.125rem — toolbar. */
        control: "size-8.5",
        /** 1.875rem — the hover actions on a grid cover. */
        sm: "size-7.5",
        /** 1.75rem — the quick actions in a list row. */
        xs: "size-7",
      },
      /** The radius lives here and nowhere else. Splitting it across `size`
          and `round` puts two `rounded-*` utilities of equal specificity on
          the same element, and the stylesheet's order decides — which meant
          `round` silently did nothing. */
      round: { true: "rounded-full", false: "rounded-md" },
    },
    defaultVariants: { variant: "ghost", size: "control", round: false },
  },
);

/**
 * A square (or round) button holding nothing but an icon.
 *
 * Always needs an `aria-label` — there is no text to read. The three sizes are
 * the three the design actually uses; the round form is for the action circles
 * that overlay cover art.
 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> &
    VariantProps<typeof iconButtonVariants> & { "aria-label": string }
>(({ className, variant, size, round, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(iconButtonVariants({ variant, size, round }), className)}
    {...props}
  />
));
IconButton.displayName = "IconButton";
