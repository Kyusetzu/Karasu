/**
 * The one answer to "should this move?", for motion CSS cannot see.
 *
 * `index.css` collapses every animation and transition under
 * `prefers-reduced-motion` and under the app's own `data-reduce-motion`
 * attribute. That covers declarative motion completely and JS-driven motion not
 * at all: a View Transition, a scroll-linked parallax, a `requestAnimationFrame`
 * loop or an `element.animate()` call is invisible to those rules and would ship
 * as unconditional movement. Anything of that kind must ask here first.
 *
 * The decision is split from the DOM read so it can be tested without a browser
 * environment, and so the reading half stays one line with nothing to get wrong.
 */

/** Either source is enough; the toggle only ever adds to the OS setting. */
export function reducedMotion(toggleOn: boolean, osPrefers: boolean): boolean {
  return toggleOn || osPrefers;
}

/**
 * Reads the live setting.
 *
 * The DOM rather than the store, so it can be called outside React — a
 * navigation wrapper runs before any component does. `stores/theme.ts` writes
 * the attribute before first paint.
 */
export function prefersReducedMotion(): boolean {
  if (typeof document === "undefined") return false;
  return reducedMotion(
    document.documentElement.hasAttribute("data-reduce-motion"),
    typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
}

/**
 * `ms`, or 0 when the user asked for less motion.
 *
 * For durations held in JS — how long to keep an exiting node mounted, how long
 * to wait before a follow-up step. Returning 0 rather than skipping the call
 * keeps the same code path in both cases, so the "reduced" branch cannot drift
 * out of sync with the animated one.
 */
export function motionDuration(
  ms: number,
  reduced = prefersReducedMotion(),
): number {
  return reduced ? 0 : ms;
}

/** One rhythm for every staggered surface. Mirrors `Skeleton`'s cycle. */
export const STAGGER_STEP_MS = 45;
export const STAGGER_CYCLE = 6;

/**
 * The stagger delay for item `index`, in ms.
 *
 * Cycled rather than unbounded: without the wrap, a hundredth cell would wait
 * four seconds for its turn. Zero under reduced motion — a stagger whose
 * duration is collapsed but whose delay is not becomes a staggered *wait*,
 * which is worse than the animation for the person who asked for less of it.
 */
export function staggerDelay(
  index: number,
  reduced = prefersReducedMotion(),
): number {
  return motionDuration((index % STAGGER_CYCLE) * STAGGER_STEP_MS, reduced);
}
