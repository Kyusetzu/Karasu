import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // `transition-surface`, not `transition-colors`: animating `color` holds the old value across a theme swap.
  "relative press coarse:hit-area inline-flex items-center justify-center gap-2 rounded-control text-sm font-medium transition-surface disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent-500",
  {
    variants: {
      variant: {
        // The accent as a tint, as the status and +1 carry theirs, so a page's main action leads without shouting.
        default: "border tint-fill tint-accent text-ink-100",
        secondary: "bg-surface-800 text-ink-100 hover:bg-surface-700",
        outline:
          "border border-surface-700 text-ink-300 hover:bg-surface-850 hover:text-ink-100",
        ghost: "text-ink-300 hover:bg-surface-850 hover:text-ink-100",
        // `text-surface-950` rather than white: it inverts with the theme and keeps contrast where white ink fails.
        danger: "bg-danger text-surface-950 hover:opacity-90",
        /** Destructive but not the primary action — bulk Remove, reset rows. */
        dangerGhost: "text-danger hover:bg-danger/10",
      },
      size: {
        default: "h-9 px-4",
        /** 2.125rem — the design's toolbar control height. */
        control: "h-8.5 px-3",
        sm: "h-8 px-3 text-xs",
        icon: "h-9 w-9",
        iconControl: "h-8.5 w-8.5",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
