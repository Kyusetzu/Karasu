import {
  useCallback,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from "react";
import { pinchUpdate, zoomAboutPoint, type ZoomView } from "@/lib/zoomMath";

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 1.6;
const WHEEL_OUT = 0.92;
const WHEEL_IN = 1.08;
export const BUTTON_STEP = 1.15;
/** Below this, a drag is a click that wobbled. */
const MOVE_THRESHOLD = 3;

const RESTING: ZoomView = { tx: 0, ty: 0, zoom: 1 };

/**
 * Pan and zoom for a `translate3d(tx, ty, 0) scale(zoom)` canvas with
 * `transform-origin: 0 0`. The arithmetic lives in `lib/zoomMath`, tested.
 *
 * Zoom is anchored to a point — the cursor for the wheel, the pinch midpoint
 * for two fingers, the viewport centre for the buttons — because zooming
 * about the origin instead walks the content out of view after two notches.
 *
 * The view is mirrored in a ref as well as in state: a pointer handler needs
 * the current offset to compute the next one, and reading it out of the state
 * closure gives whatever it was when the handler was created.
 *
 * Two pointers are a pinch: the second `pointerdown` suspends the one-finger
 * pan, each move rescales about the moving midpoint, and the last finger to
 * lift re-seeds an ordinary drag so the image does not jump. The default
 * clamp is the franchise graph's; the cover viewer widens it via `opts`.
 */
export function usePanZoom(
  viewport: RefObject<HTMLElement | null>,
  opts?: { minZoom?: number; maxZoom?: number },
) {
  const min = opts?.minZoom ?? MIN_ZOOM;
  const max = opts?.maxZoom ?? MAX_ZOOM;
  const [view, setView] = useState<ZoomView>(RESTING);
  const [dragging, setDragging] = useState(false);
  const current = useRef<ZoomView>(RESTING);
  const origin = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const moved = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const commit = useCallback((next: ZoomView) => {
    current.current = next;
    setView(next);
  }, []);

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      const next = zoomAboutPoint(current.current, factor, px, py, min, max);
      if (next !== current.current) commit(next);
    },
    [commit, min, max],
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
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // Entering a pinch: the one-finger pan stands down, and both pointers
      // are captured — a two-finger gesture is never a click, so the
      // capture-late discipline below does not apply to it.
      origin.current = null;
      moved.current = true;
      for (const id of pointers.current.keys()) {
        try {
          e.currentTarget.setPointerCapture(id);
        } catch {
          // A pointer that ended between the map write and here is fine.
        }
      }
      setDragging(true);
      return;
    }
    const { tx, ty } = current.current;
    origin.current = { x: e.clientX, y: e.clientY, tx, ty };
    moved.current = false;
    setDragging(true);
    // Deliberately NO pointer capture here. Capture retargets the derived
    // `click`/`dblclick` at the capture element, so capturing on press made
    // every button inside the canvas — nodes, zoom, collapse pills —
    // unclickable for as long as the graph has existed. Capture is taken
    // when a drag actually commits, in `onPointerMove`.
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const pts = pointers.current;
      if (pts.size === 2 && pts.has(e.pointerId)) {
        const ids = [...pts.keys()];
        const prev = ids.map((id) => pts.get(id)!);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const next = ids.map((id) => pts.get(id)!);
        const box = e.currentTarget.getBoundingClientRect();
        const rel = (p: { x: number; y: number }) => ({
          x: p.x - box.left,
          y: p.y - box.top,
        });
        commit(
          pinchUpdate(
            current.current,
            [rel(prev[0]), rel(prev[1])],
            [rel(next[0]), rel(next[1])],
            min,
            max,
          ),
        );
        return;
      }
      if (pts.has(e.pointerId)) {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      const from = origin.current;
      if (!from) return;
      // No capture is held before the threshold, so a press whose release
      // lands outside the viewport never delivers its `pointerup` — without
      // this guard the stale origin would make bare hovers pan the canvas.
      if (e.buttons === 0) {
        origin.current = null;
        pts.delete(e.pointerId);
        setDragging(false);
        return;
      }
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      if (!moved.current && Math.hypot(dx, dy) < MOVE_THRESHOLD) return;
      // The drag is real from here on: take the capture now, so the pan
      // keeps tracking past the viewport edge. A stationary click never
      // reaches this line and its `click` stays on the button it pressed.
      if (!moved.current) e.currentTarget.setPointerCapture(e.pointerId);
      moved.current = true;
      commit({ ...current.current, tx: from.tx + dx, ty: from.ty + dy });
    },
    [commit, min, max],
  );

  const onPointerUp = useCallback((e: PointerEvent<HTMLElement>) => {
    const pts = pointers.current;
    pts.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (pts.size === 1) {
      // Pinch down to one finger: re-seed an ordinary drag from the survivor
      // so the image stays put instead of jumping to a stale origin.
      const [rest] = pts.values();
      const { tx, ty } = current.current;
      origin.current = { x: rest.x, y: rest.y, tx, ty };
      return;
    }
    if (!origin.current) return;
    origin.current = null;
    setDragging(false);
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
    zoomAt,
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
