import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTheme } from "@/stores/theme";
import { type MediaListEntry } from "@/api/types";
import { useColumnCount } from "@/hooks/useColumnCount";
import { cn } from "@/lib/utils";
/** Virtualized rows chunked by hand; `rowGap` is padding, since each row is its own grid and `gap-y` does nothing. */
export function VirtualGrid({
  items,
  scrollRef,
  gridClassName,
  rowGap,
  estimateRowHeight,
  renderItem,
  focusIndex,
  onColumns,
}: {
  items: MediaListEntry[];
  scrollRef: RefObject<HTMLDivElement | null>;
  gridClassName: string;
  rowGap: number;
  estimateRowHeight: number;
  renderItem: (entry: MediaListEntry, index: number) => ReactNode;
  /** Position of the roving keyboard focus in `items`, if it is on screen. */
  focusIndex?: number | null;
  onColumns?: (columns: number) => void;
}) {
  const probeRef = useRef<HTMLDivElement>(null);
  // Keep the `coverCols` watch; it re-flows the tracks without resizing the probe, so the ResizeObserver cannot see it.
  const coverCols = useTheme((s) => s.coverCols);
  const columns = useColumnCount(probeRef, coverCols);
  const rowCount = Math.ceil(items.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 4,
  });

  // Titles wrap differently at a different column count, so the cached row measurements are worthless once it changes.
  useEffect(() => {
    virtualizer.measure();
  }, [columns, virtualizer]);

  // Arrow keys need the measured count to know what down means, so it is reported up rather than recomputed.
  useEffect(() => onColumns?.(columns), [columns, onColumns]);

  // A scrolled-out virtual row is not mounted, so moving the focus there would otherwise land on nothing.
  useEffect(() => {
    if (focusIndex == null) return;
    virtualizer.scrollToIndex(Math.floor(focusIndex / columns), {
      align: "auto",
    });
  }, [focusIndex, columns, virtualizer]);

  return (
    <>
      <div ref={probeRef} className={cn(gridClassName, "h-0")} aria-hidden />
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            className={cn(gridClassName, "absolute left-0 top-0 w-full")}
            style={{
              transform: `translateY(${row.start}px)`,
              paddingBottom: rowGap,
            }}
          >
            {items
              .slice(row.index * columns, row.index * columns + columns)
              .map((entry, i) => renderItem(entry, row.index * columns + i))}
          </div>
        ))}
      </div>
    </>
  );
}
