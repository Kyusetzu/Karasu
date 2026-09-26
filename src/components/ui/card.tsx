import { createContext, useContext, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** `raised` stands out of the page, `flat` is a bordered row or block, `sunken` is a well inside either. */
export type CardVariant = "raised" | "flat" | "sunken";

const VARIANTS: Record<CardVariant, string> = {
  // No `overflow-hidden`: the catch-light fades out before the corners, and clipping would only cut off contents.
  raised: "panel-wash panel-top rounded-panel border border-hair bg-surface-900",
  flat: "rounded-panel border border-hair bg-surface-900",
  sunken: "rounded-control border border-hair bg-surface-950",
};

/** The classes of a card, for one that must be a link, a form or an article; everything else renders `Card`. */
export function cardClass(variant: CardVariant = "raised", { interactive = false }: { interactive?: boolean } = {}) {
  return cn(VARIANTS[variant], interactive && "transition-surface hover:border-surface-700");
}

/** A panel: `raised` with the surface fill, the accent-following wash and the top catch-light, or a quieter variant. */
export function Card({
  variant = "raised",
  interactive = false,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: CardVariant; interactive?: boolean }) {
  return (
    <div
      className={cn(cardClass(variant, { interactive }), variant === "raised" ? "p-5" : variant === "flat" ? "p-4" : "p-3", className)}
      {...props}
    />
  );
}

/** The level a card's title takes: a card under a group heading is one level below it, so the outline reads right. */
export const CardHeadingLevel = createContext<2 | 3>(2);

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  const Tag = useContext(CardHeadingLevel) === 3 ? "h3" : "h2";
  return <Tag className={cn("text-base font-semibold text-ink-100", className)} {...props} />;
}
