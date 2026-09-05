// Copied from src/components/ui/button.tsx (the app's primary control), minus
// the destructive variants and the toolbar sizes the site has no use for. The
// site keeps its own copy on purpose — CLAUDE.md, "The website".
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
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
      },
      size: {
        default: "h-9 px-4",
        lg: "h-11 px-5 text-[.9375rem]",
        sm: "h-8 px-3 text-xs",
        icon: "h-9 w-9",
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

interface ButtonLinkProps
  extends AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof buttonVariants> {}

/** The same control as a link — every call to action on the site is one. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  ({ className, variant, size, ...props }, ref) => (
    <a
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
ButtonLink.displayName = "ButtonLink";
