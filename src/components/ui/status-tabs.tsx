import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface StatusTab<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/**
 * The list's status tabs, with one accent bar that slides between them.
 *
 * One bar rather than a per-tab underline: the movement itself says the two
 * are alternatives, which a fill or a colour swap has to be learned to mean.
 *
 * The bar is measured from the live DOM rather than computed, because the tab
 * widths depend on the label text and the counts — both of which change under
 * the app (a save moves an entry between statuses, and the German labels are a
 * different length again). `useLayoutEffect` so it is placed before paint;
 * measuring in `useEffect` shows the bar at its old position for a frame.
 */
export function StatusTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: readonly StatusTab<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [bar, setBar] = useState<{
    left: number;
    width: number;
    top: number;
  } | null>(null);

  // `top` is tracked, not assumed: a narrow window wraps the row, and a bar
  // pinned to the container's bottom would then float under a tab it does not
  // belong to. Measured from the active tab, it follows wherever that lands.
  const measure = useCallback(() => {
    const el = refs.current.get(value);
    setBar(
      el
        ? {
            left: el.offsetLeft,
            width: el.offsetWidth,
            top: el.offsetTop + el.offsetHeight,
          }
        : null,
    );
  }, [value]);

  // The signature covers everything that can change a tab's width: the active
  // one, the labels, and the counts.
  const signature = tabs.map((tab) => `${tab.label}:${tab.count ?? ""}`).join("|");
  useLayoutEffect(measure, [measure, signature]);

  // A resize can rewrap the row even though no tab's own width changed.
  useLayoutEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  return (
    <div
      role="tablist"
      className={cn("relative flex flex-wrap gap-x-5.5 gap-y-2", className)}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              if (el) refs.current.set(tab.value, el);
              else refs.current.delete(tab.value);
            }}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              "flex items-baseline gap-1.5 text-[.8125rem] font-medium transition-surface",
              active ? "text-ink-100" : "text-ink-500 hover:text-ink-300",
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="text-2xs tabular-nums text-ink-600">
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
      {bar && (
        <span
          aria-hidden="true"
          className="absolute h-0.5 rounded-full bg-accent-500 transition-[left,width] duration-140 ease-karasu"
          // 14px clears the header's own bottom padding, so the bar lands on
          // the header's bottom border rather than floating above it.
          style={{ left: bar.left, width: bar.width, top: bar.top + 14 }}
        />
      )}
    </div>
  );
}
