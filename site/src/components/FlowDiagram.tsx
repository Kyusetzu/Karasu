import type { ComponentType, ReactNode, SVGProps } from "react";
import { cn } from "@/lib/cn";
import { useReveal } from "@/lib/useReveal";

export interface FlowStep {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  text?: ReactNode;
}

/**
 * A row of steps joined by connectors that draw in as the row is revealed —
 * horizontal from `md`, a vertical spine below it. An ordered list, because
 * that is what it is; the connectors are decoration and say so.
 */
export function FlowDiagram({
  steps,
  className,
  tone = "accent",
}: {
  steps: FlowStep[];
  className?: string;
  tone?: "accent" | "success";
}) {
  const ref = useReveal<HTMLOListElement>(0.3);
  return (
    <ol
      ref={ref}
      data-reveal
      className={cn(
        "flow relative grid gap-6 md:grid-flow-col md:auto-cols-fr md:gap-4",
        tone === "success" && "flow-success",
        className,
      )}
    >
      {steps.map(({ icon: Icon, title, text }, i) => (
        <li
          key={title}
          className="flow-step relative flex gap-4 md:flex-col md:gap-3"
          style={{ "--i": i } as React.CSSProperties}
        >
          <span className="relative z-10 grid size-11 shrink-0 place-items-center rounded-full border border-surface-700 bg-surface-900 text-accent-400">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 pt-2 md:pt-0">
            <p className="font-brand text-[.9375rem] font-semibold text-ink-100">
              <span className="mr-1.5 text-2xs tabular-nums text-ink-600">{String(i + 1).padStart(2, "0")}</span>
              {title}
            </p>
            {text && <p className="mt-1 text-sm leading-relaxed text-ink-500">{text}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
