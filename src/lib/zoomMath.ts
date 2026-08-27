/**
 * The arithmetic under `usePanZoom`, for a `translate3d(tx,ty,0) scale(zoom)`
 * surface with `transform-origin: 0 0`. Pure so the anchor invariants live
 * under unit tests: the content under the anchor point (the cursor, or the
 * pinch midpoint) must stay under it through the gesture.
 */

export interface ZoomView {
  tx: number;
  ty: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

const clamp = (z: number, min: number, max: number) =>
  Math.min(max, Math.max(min, z));

/** Zoom about (px, py) in viewport coordinates; the content there stays put. */
export function zoomAboutPoint(
  v: ZoomView,
  factor: number,
  px: number,
  py: number,
  min: number,
  max: number,
): ZoomView {
  const zoom = clamp(v.zoom * factor, min, max);
  if (zoom === v.zoom) return v;
  const scale = zoom / v.zoom;
  return { zoom, tx: px - (px - v.tx) * scale, ty: py - (py - v.ty) * scale };
}

/**
 * One pinch step: the previous and current positions of both pointers, in
 * viewport coordinates. Scale follows the distance ratio; the content that
 * was under the old midpoint lands under the new one, so the image tracks
 * the fingers while it grows.
 */
export function pinchUpdate(
  v: ZoomView,
  prev: [Point, Point],
  next: [Point, Point],
  min: number,
  max: number,
): ZoomView {
  const pd = Math.hypot(prev[1].x - prev[0].x, prev[1].y - prev[0].y);
  const nd = Math.hypot(next[1].x - next[0].x, next[1].y - next[0].y);
  const factor = pd > 0 ? nd / pd : 1;
  const zoom = clamp(v.zoom * factor, min, max);
  const pm = { x: (prev[0].x + prev[1].x) / 2, y: (prev[0].y + prev[1].y) / 2 };
  const nm = { x: (next[0].x + next[1].x) / 2, y: (next[0].y + next[1].y) / 2 };
  const scale = zoom / v.zoom;
  return {
    zoom,
    tx: nm.x - (pm.x - v.tx) * scale,
    ty: nm.y - (pm.y - v.ty) * scale,
  };
}
