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

/** How long a whole chart series has to finish arriving. */
export const SERIES_WINDOW_MS = 260;

/**
 * The delay for item `index` of a known `count`-item series, in ms.
 *
 * `staggerDelay` wraps every sixth item, which is right for a grid or a list —
 * they are unbounded, and the wrap is what stops the hundredth cell waiting
 * four seconds. It is wrong for a chart: a chart is read as *one shape*
 * arriving, so a delay that returns to zero partway through looks like the
 * animation stalled and started again. That is what a fourteen-tile treemap
 * was doing.
 *
 * Bounded instead by compressing the step as the series grows, so the whole
 * series still lands inside `SERIES_WINDOW_MS` however many members it has,
 * while a short one keeps the same rhythm as everything else in the app.
 */
export function seriesDelay(
  index: number,
  count: number,
  reduced = prefersReducedMotion(),
): number {
  if (index <= 0 || count <= 1) return 0;
  const step = Math.min(STAGGER_STEP_MS, SERIES_WINDOW_MS / (count - 1));
  return motionDuration(Math.round(index * step), reduced);
}
