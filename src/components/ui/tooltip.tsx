import type { ReactElement, ReactNode } from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";

/** Lets neighbouring tooltips open at once after the first, so a pointer running down a rail reads each name. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <BaseTooltip.Provider delay={350}>{children}</BaseTooltip.Provider>;
}

/** A name shown beside a control on hover and on keyboard focus; visual only, so the control keeps its own label. */
export function Tooltip({
  label,
  side = "right",
  children,
}: {
  label: string;
  side?: "top" | "right" | "bottom" | "left";
  /** The control it names; it must take a ref and carry its own accessible name. */
  children: ReactElement;
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={10} collisionPadding={8} className="z-popover">
          <BaseTooltip.Popup className="origin-(--transform-origin) whitespace-nowrap rounded-control border border-hair bg-surface-900 px-2.5 py-1.5 text-xs font-medium text-ink-100 shadow-float data-open:animate-pop-in data-closed:animate-pop-out">
            {label}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
