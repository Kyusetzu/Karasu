import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface StatusTab<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/** The list's status tabs with one sliding accent bar, measured from the DOM in `useLayoutEffect` so it lands before paint. */
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

  // `top` is measured from the active tab, not pinned to the container: a narrow window wraps the row.
  const measure = useCallback(() => {
    const el = refs.current.get(value);
    if (!el) return setBar(null);
    // Keep the +14 to the last wrapped row only: it matches the consumer's bottom padding and strikes through any row above.
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

  // The signature covers everything that can change a tab's width: the active one, the labels, and the counts.
  const signature = tabs.map((tab) => `${tab.label}:${tab.count ?? ""}`).join("|");
  useLayoutEffect(measure, [measure, signature]);

  // Keep the ResizeObserver: the sidebar collapsing rewraps the row with no window resize at all.
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
