import { PULL_SLOP_PX } from "@/lib/pullToSync";

/** The shell's swipes as pure predicates, the bar's flick up and the list's tab swipe, testable without a pointer. */

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

/** A sideways swipe between the list's status tabs, decided on the same slop sample as the pull, so they never both win. */
export const TAB_SWIPE_SLOP_PX = PULL_SLOP_PX;
/** The shortest swipe that changes the tab; a narrower flick is a wobble on the way down the list. */
export const TAB_SWIPE_MIN_PX = 64;
/** Or this share of the width, whichever is more, so a tablet asks for the same gesture a phone does. */
export const TAB_SWIPE_FRACTION = 0.18;
/** Where Android's own back gesture lives; a touch that starts in these strips is the system's, not the list's. */
export const EDGE_GUARD_PX = 24;

/** The axis a drag has committed to, or null while it is still inside the slop; a tie is vertical, like the pull's. */
export function swipeAxis(dx: number, dy: number): "x" | "y" | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return "y";
  if (Math.max(Math.abs(dx), Math.abs(dy)) < TAB_SWIPE_SLOP_PX) return null;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

/** The step a finished swipe asks for: left is the next tab, right the previous, and a short or steep one is none. */
export function tabSwipe({ dx, dy, width }: { dx: number; dy: number; width: number }): 1 | -1 | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const need = Math.max(TAB_SWIPE_MIN_PX, width * TAB_SWIPE_FRACTION);
  // Twice as wide as it is tall, so a diagonal scroll that committed sideways by a hair still changes nothing.
  if (Math.abs(dx) < need || Math.abs(dx) < 2 * Math.abs(dy)) return null;
  return dx < 0 ? 1 : -1;
}

/** The neighbour a step lands on, or null past either end: the tabs are a row, not a ring. */
export function adjacentTab<T>(order: readonly T[], current: T, step: 1 | -1): T | null {
  const at = order.indexOf(current);
  if (at < 0) return null;
  return order[at + step] ?? null;
}

/** How far the list follows the finger: damped toward a neighbour, a short rubber band where there is none. */
export function swipeOffset(dx: number, hasNeighbour: boolean): number {
  if (!Number.isFinite(dx)) return 0;
  if (hasNeighbour) return dx * 0.45;
  return Math.sign(dx) * Math.min(Math.abs(dx) * 0.15, 36);
}

/** True for a touch that starts in either edge strip, where the system back gesture is. */
export function isEdgeStart(x: number, width: number): boolean {
  return x < EDGE_GUARD_PX || x > width - EDGE_GUARD_PX;
}

/** How far a sideways trackpad scroll travels before it counts as one swipe. */
export const WHEEL_STEP_PX = 60;
/** A pause this long between wheel events ends a gesture, so a swipe's momentum tail cannot fire a second step. */
export const WHEEL_QUIET_MS = 200;

export interface WheelGesture {
  /** The sideways distance scrolled so far, signed like `deltaX`: positive is toward the next item. */
  sum: number;
  /** When its last event arrived, in the event's own clock. */
  at: number;
  /** Whether it has stepped already; one gesture is one step however far it runs. */
  fired: boolean;
}

/** One wheel event folded into the running gesture, plus the step it completes; a mostly vertical scroll is none. */
export function wheelStep(
  gesture: WheelGesture | null,
  { dx, dy, t }: { dx: number; dy: number; t: number },
): { gesture: WheelGesture | null; step: 1 | -1 | null } {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) <= Math.abs(dy)) {
    return { gesture, step: null };
  }
  const fresh = !gesture || !(t - gesture.at <= WHEEL_QUIET_MS);
  const sum = (fresh ? 0 : gesture.sum) + dx;
  const fired = !fresh && gesture.fired;
  if (!fired && Math.abs(sum) >= WHEEL_STEP_PX) {
    return { gesture: { sum, at: t, fired: true }, step: sum > 0 ? 1 : -1 };
  }
  return { gesture: { sum, at: t, fired }, step: null };
}
