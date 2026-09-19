/** The bottom bar's upward swipe as a pure predicate, so the thresholds are testable without a pointer. */

/** Far enough that a tap, a jitter or a mis-hit on a bar slot cannot be read as a swipe. */
export const SWIPE_MIN_PX = 48;
/** Past this the finger was resting on the bar, not flicking off it, and a rest is not a command. */
export const SWIPE_MAX_MS = 600;

export interface SwipeSample {
  /** Signed, screen coordinates: up is negative, the same sense a pointer event reports. */
  dx: number;
  dy: number;
  ms: number;
}

export function isPaletteSwipe({ dx, dy, ms }: SwipeSample): boolean {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || ms > SWIPE_MAX_MS) return false;
  const up = -dy;
  if (up < SWIPE_MIN_PX) return false;
  // Dominantly vertical, or a diagonal wipe across the bar would open the palette on the way past.
  return up > Math.abs(dx);
}
