import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTheme } from "@/stores/theme";
import { type MediaListEntry } from "@/api/types";
import { useColumnCount } from "@/hooks/useColumnCount";
import { cn } from "@/lib/utils";
/**
 * A CSS grid whose rows are virtualized: only the rows near the viewport are
 * mounted. A completed list can run to several thousand entries, and mounting
 * every cover at once is what made switching to this page stutter.
 *
 * Rows are chunked by hand, so the number of columns has to be known — see
 * `useColumnCount` for why it is measured rather than computed. The probe is a
 * zero-height copy of the grid: `auto-fill` resolves its full track list even
 * with no children, which gives a column count on the very first render and
 * keeps one source of truth for the layout in `index.css`.
 *
 * `rowGap` is applied as padding rather than `gap-y` because each row is now
 * its own grid — a gap between the rows of *different* grids does nothing. As
 * padding it lands inside the border box, so `measureElement` counts it.
 */
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
  // The column setting re-flows the grid tracks without changing the probe's
  // own size, so the ResizeObserver inside the hook never fires for it — see
  // `watch` there.
  const coverCols = useTheme((s) => s.coverCols);
  const columns = useColumnCount(probeRef, coverCols);
  const rowCount = Math.ceil(items.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 4,
  });

  // Titles wrap differently at a different column count, so the cached row
  // measurements are worthless once it changes.
  useEffect(() => {
    virtualizer.measure();
  }, [columns, virtualizer]);

  // The count is measured from the resolved track, and arrow keys need it to
  // know what "down" means — so it is reported up rather than recomputed.
  useEffect(() => onColumns?.(columns), [columns, onColumns]);

  // A virtualized row that is scrolled out is not mounted, so moving the focus
  // there would otherwise land it on nothing.
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
