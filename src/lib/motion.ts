/** The one reduce-motion answer for what CSS cannot see: View Transitions, WAAPI, scroll handlers and timeouts ask here. */

/** Either source is enough; the toggle only ever adds to the OS setting. */
export function reducedMotion(toggleOn: boolean, osPrefers: boolean): boolean {
  return toggleOn || osPrefers;
}

/** Reads the live setting from the DOM rather than the store, so it works outside React before any component runs. */
export function prefersReducedMotion(): boolean {
  if (typeof document === "undefined") return false;
  return reducedMotion(
    document.documentElement.hasAttribute("data-reduce-motion"),
    typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
}

/** `ms`, or 0 under reduced motion, so JS-held durations keep one code path instead of a branch that can drift. */
export function motionDuration(
  ms: number,
  reduced = prefersReducedMotion(),
): number {
  return reduced ? 0 : ms;
}

/** One rhythm for every staggered entrance; the skeleton shimmer shares the cycle but not the step. */
export const STAGGER_STEP_MS = 45;
export const STAGGER_CYCLE = 6;

/** The shimmer's phase step; looser than an entrance step because a loop phase is not an arrival. */
const SKELETON_STEP_MS = 90;
/** The shimmer's phase offset for cell `index`; no reduced-motion branch, since the CSS collapse already zeroes it. */
export function skeletonDelay(index: number): number {
  return (index % STAGGER_CYCLE) * SKELETON_STEP_MS;
}

/** The cycled stagger delay for item `index`; zero under reduced motion, or a collapsed stagger becomes a staggered wait. */
export function staggerDelay(
  index: number,
  reduced = prefersReducedMotion(),
): number {
  return motionDuration((index % STAGGER_CYCLE) * STAGGER_STEP_MS, reduced);
}

/** How long a whole chart series has to finish arriving. */
export const SERIES_WINDOW_MS = 260;

/** The delay for item `index` of a `count`-item series, compressed to fit the window; a chart must never wrap to zero. */
export function seriesDelay(
  index: number,
  count: number,
  reduced = prefersReducedMotion(),
): number {
  if (index <= 0 || count <= 1) return 0;
  const step = Math.min(STAGGER_STEP_MS, SERIES_WINDOW_MS / (count - 1));
  return motionDuration(Math.round(index * step), reduced);
}
