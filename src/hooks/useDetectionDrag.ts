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

export interface PressHandlers {
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick?: () => void;
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/** Moves and widens the floating card with the arithmetic in `lib/detectionLayout`; disabled, it binds nothing at all. */
export function useDetectionDrag(card: RefObject<HTMLElement | null>, enabled: boolean) {
  const [layout, setLayout] = useState<DetectionLayout>(() =>
    enabled ? loadDetectionLayout() : DEFAULT_DETECTION_LAYOUT,
  );
  const [dragging, setDragging] = useState(false);
  const live = useRef(layout);
  const gesture = useRef<Gesture | null>(null);
  const unbind = useRef<(() => void) | null>(null);

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

  // The gesture's own listeners die with the component, or a card unmounted mid-drag would keep moving a ghost.
  useEffect(() => () => unbind.current?.(), []);

  const end = useCallback(() => {
    unbind.current?.();
    unbind.current = null;
    const g = gesture.current;
    gesture.current = null;
    setDragging(false);
    const moved = g?.kind === "resize" || (g?.kind === "drag" && g.origin !== null);
    if (moved) saveDetectionLayout(live.current);
  }, []);

  const move = useCallback(
    (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId) return;
      // A release outside the window delivers no `pointerup`; the next bare hover must not move the card.
      if (e.buttons === 0) return end();
      if (g.kind === "resize") {
        const { left, width } = resizeWidth(g.origin, g.edge, e.clientX, viewport());
        const cur = live.current;
        commit({
          width,
          position: cur.position && left !== null ? { left, top: cur.position.top } : cur.position,
        });
        return;
      }
      if (!g.origin) {
        if (!pastThreshold(e.clientX - g.start.x, e.clientY - g.start.y)) return;
        // Seeded from where the card is drawn, so undocking moves it by the pointer's travel and nothing else.
        const box = card.current?.getBoundingClientRect();
        const from = live.current.position ?? { left: box?.left ?? 0, top: box?.top ?? 0 };
        g.origin = { pointer: g.start, position: from };
        setDragging(true);
      }
      const position = dragPosition(g.origin, { x: e.clientX, y: e.clientY }, size(), viewport());
      commit({ ...live.current, position });
    },
    [card, commit, end, size],
  );

  // Bound on the window for the gesture's life: a fast pointer leaves a two-rem handle before its second event.
  const begin = useCallback(
    (g: Gesture) => {
      gesture.current = g;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      unbind.current = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
      };
    },
    [move, end],
  );

  const onHandleDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || gesture.current) return;
      if (e.target instanceof HTMLElement && e.target.closest(OWN_PRESS)) return;
      // The default of a press is a text selection that would then follow the pointer across the page.
      e.preventDefault();
      begin({ kind: "drag", pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, origin: null });
    },
    [begin],
  );

  const onEdgeDown = useCallback(
    (edge: ResizeEdge) => (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || gesture.current) return;
      e.preventDefault();
      begin({
        kind: "resize",
        pointerId: e.pointerId,
        edge,
        origin: { pointerX: e.clientX, left: live.current.position?.left ?? null, width: live.current.width },
      });
      setDragging(true);
    },
    [begin],
  );

  const reset = useCallback(() => {
    const next = { ...live.current, position: null };
    commit(next);
    saveDetectionLayout(next);
  }, [commit]);

  const handleProps: PressHandlers = enabled ? { onPointerDown: onHandleDown, onDoubleClick: reset } : {};
  const edgeProps = (edge: ResizeEdge): PressHandlers => (enabled ? { onPointerDown: onEdgeDown(edge) } : {});

  return {
    position: enabled ? layout.position : null,
    width: enabled ? layout.width : DEFAULT_DETECTION_LAYOUT.width,
    dragging,
    handleProps,
    edgeProps,
    reset,
  };
}
