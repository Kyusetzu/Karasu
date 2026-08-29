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
    if (!el) return setBar(null);
    // Whether the active tab sits on the LAST wrapped row. The +14 below is
    // calibrated to the consumer's own bottom padding and is only right
    // there; applied to an earlier row it put the 2px bar six pixels into
    // the next row's line boxes — an accent strike-through, photographed on
    // the second device round of the phone shell.
    let maxTop = 0;
    for (const tab of refs.current.values()) {
      if (tab.offsetTop > maxTop) maxTop = tab.offsetTop;
    }
    const lastRow = el.offsetTop >= maxTop;
    setBar({
      left: el.offsetLeft,
      width: el.offsetWidth,
      // On an earlier row the bar lives inside the 8px `gap-y-2` instead.
      top: el.offsetTop + el.offsetHeight + (lastRow ? 14 : 2),
    });
  }, [value]);

  // The signature covers everything that can change a tab's width: the active
  // one, the labels, and the counts.
  const signature = tabs.map((tab) => `${tab.label}:${tab.count ?? ""}`).join("|");
  useLayoutEffect(measure, [measure, signature]);

  // A resize can rewrap the row even though no tab's own width changed —
  // and so can a *container* resize with no window resize at all (the
  // sidebar collapsing), which is what the ResizeObserver is for.
  const listRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    window.addEventListener("resize", measure);
    const ro = listRef.current ? new ResizeObserver(() => measure()) : null;
    if (ro && listRef.current) ro.observe(listRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [measure]);

  return (
    <div
      ref={listRef}
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
          className="absolute h-0.5 rounded-full bg-accent-500 transition-[left,width]"
          // The row-aware offset is measured in — see `measure`.
          style={{ left: bar.left, width: bar.width, top: bar.top }}
        />
      )}
    </div>
  );
}
