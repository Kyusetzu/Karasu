import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  DEFAULT_DETECTION_LAYOUT,
  clampPosition,
  clampWidth,
  dragPosition,
  loadDetectionLayout,
  pastThreshold,
  resizeWidth,
  saveDetectionLayout,
  type DetectionLayout,
  type DragOrigin,
  type ResizeEdge,
  type ResizeOrigin,
} from "@/lib/detectionLayout";

type Gesture =
  | { kind: "drag"; pointerId: number; start: { x: number; y: number }; origin: DragOrigin | null }
  | { kind: "resize"; pointerId: number; edge: ResizeEdge; origin: ResizeOrigin };

/** Controls inside the handle keep their own press; a drag starts only on the handle's own surface. */
const OWN_PRESS = "a, button, input, select, textarea";

export interface PointerHandlers {
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel?: (e: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick?: () => void;
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/** jsdom has no pointer capture, and a browser that refuses it only loses tracking past the window's edge. */
function capture(e: ReactPointerEvent<HTMLElement>): void {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // Nothing to do: the gesture still works while the pointer stays over the element.
  }
}

function release(e: ReactPointerEvent<HTMLElement>): void {
  try {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  } catch {
    // Same reason as in `capture`.
  }
}

/** Moves and widens the floating card with the arithmetic in `lib/detectionLayout`; disabled, it binds nothing at all. */
export function useDetectionDrag(card: RefObject<HTMLElement | null>, enabled: boolean) {
  const [layout, setLayout] = useState<DetectionLayout>(() =>
    enabled ? loadDetectionLayout() : DEFAULT_DETECTION_LAYOUT,
  );
  const [dragging, setDragging] = useState(false);
  const live = useRef(layout);
  const gesture = useRef<Gesture | null>(null);
  const moved = useRef(false);

  const commit = useCallback((next: DetectionLayout) => {
    live.current = next;
    setLayout(next);
  }, []);

  const size = useCallback(() => {
    const box = card.current?.getBoundingClientRect();
    return { width: box?.width ?? live.current.width, height: box?.height ?? 0 };
  }, [card]);

  // A window that shrank, or a card that grew under a phase change, must not leave the card hanging off the edge.
  const reclamp = useCallback(() => {
    const cur = live.current;
    const vp = viewport();
    const width = clampWidth(cur.width, vp.width);
    const position = cur.position ? clampPosition(cur.position, { ...size(), width }, vp) : null;
    if (width !== cur.width || position?.left !== cur.position?.left || position?.top !== cur.position?.top) {
      commit({ position, width });
    }
  }, [commit, size]);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("resize", reclamp);
    const observer = new ResizeObserver(reclamp);
    if (card.current) observer.observe(card.current);
    return () => {
      window.removeEventListener("resize", reclamp);
      observer.disconnect();
    };
  }, [enabled, reclamp, card]);

  const end = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!gesture.current || gesture.current.pointerId !== e.pointerId) return;
      release(e);
      gesture.current = null;
      setDragging(false);
      if (moved.current) {
        saveDetectionLayout(live.current);
        // `click` fires after `pointerup`, so the flag outlives this handler and dies on the next tick.
        setTimeout(() => (moved.current = false), 0);
      }
    },
    [],
  );

  const onHandleDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || gesture.current) return;
    if (e.target instanceof HTMLElement && e.target.closest(OWN_PRESS)) return;
    gesture.current = {
      kind: "drag",
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      origin: null,
    };
    moved.current = false;
  }, []);

  const onHandleMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g || g.kind !== "drag" || g.pointerId !== e.pointerId) return;
      // A release outside the window delivers no `pointerup`; the next bare hover must not move the card.
      if (e.buttons === 0) return end(e);
      if (!g.origin) {
        if (!pastThreshold(e.clientX - g.start.x, e.clientY - g.start.y)) return;
        // Seeded from where the card is drawn, so undocking moves it by the pointer's travel and nothing else.
        const box = card.current?.getBoundingClientRect();
        const from = live.current.position ?? { left: box?.left ?? 0, top: box?.top ?? 0 };
        g.origin = { pointer: g.start, position: from };
        capture(e);
        moved.current = true;
        setDragging(true);
      }
      const position = dragPosition(g.origin, { x: e.clientX, y: e.clientY }, size(), viewport());
      commit({ ...live.current, position });
    },
    [card, commit, end, size],
  );

  const reset = useCallback(() => {
    const next = { ...live.current, position: null };
    commit(next);
    saveDetectionLayout(next);
  }, [commit]);

  const onEdgeDown = useCallback(
    (edge: ResizeEdge) => (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || gesture.current) return;
      gesture.current = {
        kind: "resize",
        pointerId: e.pointerId,
        edge,
        origin: { pointerX: e.clientX, left: live.current.position?.left ?? null, width: live.current.width },
      };
      moved.current = true;
      capture(e);
      setDragging(true);
    },
    [],
  );

  const onEdgeMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g || g.kind !== "resize" || g.pointerId !== e.pointerId) return;
      if (e.buttons === 0) return end(e);
      const { left, width } = resizeWidth(g.origin, g.edge, e.clientX, viewport());
      const cur = live.current;
      commit({
        width,
        position: cur.position && left !== null ? { left, top: cur.position.top } : cur.position,
      });
    },
    [commit, end],
  );

  const handleProps: PointerHandlers = enabled
    ? {
        onPointerDown: onHandleDown,
        onPointerMove: onHandleMove,
        onPointerUp: end,
        onPointerCancel: end,
        onDoubleClick: reset,
      }
    : {};

  const edgeProps = (edge: ResizeEdge): PointerHandlers =>
    enabled
      ? { onPointerDown: onEdgeDown(edge), onPointerMove: onEdgeMove, onPointerUp: end, onPointerCancel: end }
      : {};

  return {
    position: enabled ? layout.position : null,
    width: enabled ? layout.width : DEFAULT_DETECTION_LAYOUT.width,
    dragging,
    handleProps,
    edgeProps,
    reset,
  };
}
