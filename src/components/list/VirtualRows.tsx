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

/**
 * A flat list whose rows are virtualized inside a scroll container it does not
 * own.
 *
 * `VirtualGrid` is the sibling of this and deliberately stays separate: it
 * chunks a grid into rows and needs a measured column count, and it is the
 * only thing in its scroller. This one is a plain list, and several of them
 * share the local library's single scroller — each under its own header and
 * inside its own bordered card, which is why the sections could not simply be
 * flattened into one virtualizer.
 *
 * `scrollMargin` is what makes sharing work: the virtualizer's coordinates are
 * relative to the scroll element, so each instance has to say how far down that
 * element its own first row begins. It is measured rather than computed,
 * because everything above it — a notice line, a section that grew, a filter
 * that collapsed one — moves it.
 *
 * Row heights are measured too (`measureElement`), since a row that expands to
 * show its files is several times the height of one that has not.
 */
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
  /** `isLast` is passed because the last *logical* row is not the last DOM
      child once rows are absolutely positioned, so `last:` utilities cannot
      see it — and it is what closes the card's bottom border. */
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
    // Distance between the two boxes in the scroller's own coordinates. Read
    // from rects plus the current scroll offset rather than `offsetTop`, which
    // is relative to the nearest positioned ancestor and silently wrong the
    // moment one is introduced between them.
    const top =
      el.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    setScrollMargin((prev) => (Math.abs(prev - top) < 0.5 ? prev : top));
  }, [scrollRef]);

  useLayoutEffect(measureMargin);

  // Anything above this list changing height moves its start. A ResizeObserver
  // on the scroller's content catches the cases a render of *this* component
  // cannot see — a sibling section expanding, an image finally loading.
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
