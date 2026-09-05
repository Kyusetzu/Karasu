// The stagger subset of src/lib/motion.ts, copied on purpose — CLAUDE.md, "The
// website". The reduced-motion question itself is answered by `motion`'s
// `useReducedMotion` and by the CSS the token sync brings over.

/** One rhythm for every staggered entrance: 45 ms steps, wrapping after six. */
export const STAGGER_STEP_MS = 45;
export const STAGGER_CYCLE = 6;

/**
 * The delay for the i-th item of a staggered entrance, in ms. Wraps so a long
 * list does not make its last row wait a second; a chart series should use
 * `seriesDelay` instead, where a wrap reads as a stall.
 */
export function staggerDelay(i: number): number {
  return (i % STAGGER_CYCLE) * STAGGER_STEP_MS;
}

/** The whole series lands inside one window, however many items it has. */
export const SERIES_WINDOW_MS = 260;
export function seriesDelay(i: number, count: number): number {
  if (count <= 1) return 0;
  return Math.round(i * Math.min(STAGGER_STEP_MS, SERIES_WINDOW_MS / (count - 1)));
}
