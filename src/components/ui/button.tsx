import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // `transition-surface`, not `transition-colors`: the latter animates `color`,
  // which makes the browser hold the old value across a theme swap.
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-surface disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent-500",
  {
    variants: {
      variant: {
        // accent-500 is the accent *as a fill*; 600 is its pressed-in shade.
        default: "bg-accent-500 text-accent-ink hover:bg-accent-600",
        secondary: "bg-surface-800 text-ink-100 hover:bg-surface-700",
        outline:
          "border border-surface-700 text-ink-300 hover:bg-surface-850 hover:text-ink-100",
        ghost: "text-ink-300 hover:bg-surface-850 hover:text-ink-100",
        // `text-surface-950` rather than white, because it inverts with the
        // theme: 7.12:1 over the dark-theme red and 6.07:1 over the light one.
        // The handoff specifies white ink, which measures 2.73:1 on the dark
        // red and fails.
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
