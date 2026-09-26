import { useEffect, useRef, type RefObject } from "react";
import { swipeAxis, swipeOffset, tabSwipe, wheelStep, type WheelGesture } from "@/lib/navSwipe";
import { swipePainter } from "@/hooks/useTabSwipe";

/** A wheel reporting in lines, as a mouse wheel with Shift can, is scaled to roughly the pixels a trackpad reports. */
const LINE_PX = 16;

/** The desktop's swipe for an endless carousel: a mouse drag or a sideways trackpad scroll steps as a finger would. */
export function usePointerSwipe({
  surface,
  content,
  enabled,
  onStep,
}: {
  surface: RefObject<HTMLElement | null>;
  /** What follows the drag; an ancestor must clip it, or it widens the page. */
  content: RefObject<HTMLElement | null>;
  enabled: boolean;
  onStep: (step: 1 | -1) => void;
}): void {
  // Read through a ref, so the listeners are bound once per surface and still call the current handler.
  const latest = useRef(onStep);
  latest.current = onStep;

  useEffect(() => {
    const el = surface.current;
    if (!enabled || !el) return;
    const { paint, settle, enter } = swipePainter(content);
    let start: { x: number; y: number; id: number } | null = null;
    let axis: "x" | "y" | null = null;
    // A drag ends on a pointerup over a link, and the click that follows it must not open the title it was dragged from.
    let swallowClick = false;
    let wheel: WheelGesture | null = null;

    const land = (step: 1 | -1 | null) => {
      if (step === null) return settle();
      latest.current(step);
      enter(step);
    };

    const onDown = (e: PointerEvent) => {
      swallowClick = false;
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      axis = null;
    };
    const onMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      axis ??= swipeAxis(dx, e.clientY - start.y);
      if (axis === "y") {
        start = null;
        return;
      }
      if (axis !== "x") return;
      // Captured, so the release still reaches us when the pointer leaves the card mid-drag.
      if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
      swallowClick = true;
      paint(swipeOffset(dx, true), 0);
    };
    const onUp = (e: PointerEvent) => {
      const drag = start && axis === "x" ? start : null;
      start = null;
      axis = null;
      if (!drag) return;
      land(tabSwipe({ dx: e.clientX - drag.x, dy: e.clientY - drag.y, width: el.clientWidth }));
    };
    const onCancel = () => {
      const wasDragging = start !== null && axis === "x";
      start = null;
      axis = null;
      if (wasDragging) settle();
    };
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    // A link or an image would otherwise start the browser's own drag, which cancels the pointer mid-swipe.
    const onDragStart = (e: DragEvent) => e.preventDefault();
    const onWheel = (e: WheelEvent) => {
      const scale = e.deltaMode === 1 ? LINE_PX : 1;
      const dx = e.deltaX * scale;
      const dy = e.deltaY * scale;
      const out = wheelStep(wheel, { dx, dy, t: e.timeStamp });
      wheel = out.gesture;
      // Only the sideways scroll is ours: the page keeps its vertical one, and the WebView never sees a history swipe.
      if (Math.abs(dx) > Math.abs(dy)) e.preventDefault();
      if (out.step) land(out.step);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("click", onClick, true);
    el.addEventListener("dragstart", onDragStart);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("dragstart", onDragStart);
      el.removeEventListener("wheel", onWheel);
      paint(0, 0);
    };
  }, [enabled, surface, content]);
}
