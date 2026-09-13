import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/** A flat virtualized list sharing a scroller it does not own; each instance measures its own `scrollMargin`. */
export function VirtualRows<T>({
  items,
  scrollRef,
  estimateRowHeight,
  renderItem,
  getKey,
  className,
}: {
  items: T[];
  /** The shared scroll container. */
  scrollRef: RefObject<HTMLDivElement | null>;
  estimateRowHeight: number;
  /** `isLast` is passed because absolutely positioned rows hide the last logical row from `last:` utilities. */
  renderItem: (item: T, index: number, isLast: boolean) => ReactNode;
  getKey: (item: T, index: number) => string | number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const measureMargin = useCallback(() => {
    const el = containerRef.current;
    const scroller = scrollRef.current;
    if (!el || !scroller) return;
    // Rects plus scroll offset, not `offsetTop`, which goes wrong the moment a positioned ancestor sits between them.
    const top =
      el.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    setScrollMargin((prev) => (Math.abs(prev - top) < 0.5 ? prev : top));
  }, [scrollRef]);

  useLayoutEffect(measureMargin);

  // A ResizeObserver on the scroller's children catches a sibling growing, which no render of this component sees.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const ro = new ResizeObserver(measureMargin);
    ro.observe(scroller);
    for (const child of Array.from(scroller.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [scrollRef, measureMargin]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 6,
    scrollMargin,
  });

  const rows = virtualizer.getVirtualItems();

  return (
    <div ref={containerRef} className={className}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {rows.map((row) => (
          <div
            key={getKey(items[row.index], row.index)}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
          >
            {renderItem(items[row.index], row.index, row.index === items.length - 1)}
          </div>
        ))}
      </div>
    </div>
  );
}
