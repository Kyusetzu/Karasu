import {
  useCallback,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from "react";

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 1.6;
const WHEEL_OUT = 0.92;
const WHEEL_IN = 1.08;
export const BUTTON_STEP = 1.15;
/** Below this, a drag is a click that wobbled. */
const MOVE_THRESHOLD = 3;

interface View {
  tx: number;
  ty: number;
  zoom: number;
}
const RESTING: View = { tx: 0, ty: 0, zoom: 1 };

const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Pan and zoom for a `translate3d(tx, ty, 0) scale(zoom)` canvas with
 * `transform-origin: 0 0`.
 *
 * Zoom is anchored to a point — the cursor for the wheel, the viewport centre
 * for the buttons — because zooming about the origin instead walks the content
 * out of view after two notches.
 *
 * The view is mirrored in a ref as well as in state: a pointer handler needs
 * the current offset to compute the next one, and reading it out of the state
 * closure gives whatever it was when the handler was created.
 */
export function usePanZoom(viewport: RefObject<HTMLElement | null>) {
  const [view, setView] = useState<View>(RESTING);
  const [dragging, setDragging] = useState(false);
  const current = useRef<View>(RESTING);
  const origin = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const moved = useRef(false);

  const commit = useCallback((next: View) => {
    current.current = next;
    setView(next);
  }, []);

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      const v = current.current;
      const zoom = clamp(v.zoom * factor);
      if (zoom === v.zoom) return;
      // Keep the content point under (px, py) exactly where it is.
      const scale = zoom / v.zoom;
      commit({ zoom, tx: px - (px - v.tx) * scale, ty: py - (py - v.ty) * scale });
    },
    [commit],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const box = viewport.current?.getBoundingClientRect();
      zoomAt(factor, (box?.width ?? 0) / 2, (box?.height ?? 0) / 2);
    },
    [viewport, zoomAt],
  );

  const onWheel = useCallback(
    (e: WheelEvent<HTMLElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      zoomAt(
        e.deltaY > 0 ? WHEEL_OUT : WHEEL_IN,
        e.clientX - box.left,
        e.clientY - box.top,
      );
    },
    [zoomAt],
  );

  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const { tx, ty } = current.current;
    origin.current = { x: e.clientX, y: e.clientY, tx, ty };
    moved.current = false;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const from = origin.current;
      if (!from) return;
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (!moved.current && Math.hypot(dx, dy) < MOVE_THRESHOLD) return;
      moved.current = true;
      commit({ ...current.current, tx: from.tx + dx, ty: from.ty + dy });
    },
    [commit],
  );

  const onPointerUp = useCallback((e: PointerEvent<HTMLElement>) => {
    if (!origin.current) return;
    origin.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // `click` fires *after* `pointerup`, so the flag has to outlive this
    // handler and die on the next tick. Clearing it here would let every pan
    // end in a selection; never clearing it would suppress selection forever.
    if (moved.current) setTimeout(() => (moved.current = false), 0);
  }, []);

  /** True when the click currently firing was the tail of a pan. */
  const dragged = useCallback(() => moved.current, []);

  const reset = useCallback(() => commit(RESTING), [commit]);

  return {
    ...view,
    dragging,
    dragged,
    reset,
    zoomBy,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onWheel,
    },
  };
}
