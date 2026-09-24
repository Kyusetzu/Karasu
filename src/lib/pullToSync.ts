/** The pull-to-sync gesture as a pure reducer, so its thresholds and the "not while scrolled" rule are testable. */

/** Android's touch slop: below this a finger is holding still, not dragging. */
export const PULL_SLOP_PX = 8;
/** Matches Android's SwipeRefreshLayout trigger; damping means the finger travels further than this. */
export const PULL_TRIGGER_PX = 64;
/** The indicator never travels past this, so a long pull cannot walk it down the screen. */
export const PULL_MAX_PX = 96;

export type PullPhase = "idle" | "tracking" | "pulling" | "ready";

export interface PullState {
  phase: PullPhase;
  /** Damped pixels the indicator has travelled; zero until the gesture is ours. */
  offset: number;
  /** Where the finger was when tracking began. */
  startY: number;
}

export interface PullSample {
  y: number;
  scrollTop: number;
  touches: number;
  syncing: boolean;
}

export const PULL_IDLE: PullState = { phase: "idle", offset: 0, startY: 0 };

/** Asymptotic, so the pull gets heavier rather than ending at a wall, and the cap is reached only in the limit. */
export function pullOffset(raw: number): number {
  if (raw <= 0) return 0;
  return PULL_MAX_PX * (1 - Math.exp(-raw / PULL_MAX_PX));
}

/** Declared to scroll, whether or not it currently has anything to scroll. */
export function scrollsByStyle(overflowY: string): boolean {
  return overflowY === "auto" || overflowY === "scroll";
}

/** A surface with `touch-action: none` handles its own drags, so a pull must never start on it. */
export function ownsGestures(touchAction: string): boolean {
  return touchAction === "none";
}

/** An overflow that scrolls and content that overflows it; anything else is a container the gesture must look past. */
export function isScrollableStyle(
  overflowY: string,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollsByStyle(overflowY) && scrollHeight > clientHeight;
}

/** Tracking starts only at the very top, with one finger, and never while a sync is already running. */
export function pullBegin(sample: PullSample): PullState {
  if (sample.syncing || sample.touches !== 1 || sample.scrollTop > 0) return PULL_IDLE;
  return { phase: "tracking", offset: 0, startY: sample.y };
}

/** Folds one move in; the gesture becomes ours only past the slop, downward, still at the top and still one finger. */
export function pullMove(state: PullState, sample: PullSample): PullState {
  if (state.phase === "idle") return state;
  if (sample.syncing || sample.touches !== 1 || sample.scrollTop > 0) return PULL_IDLE;
  const raw = sample.y - state.startY;
  if (raw < PULL_SLOP_PX) return { ...state, phase: "tracking", offset: 0 };
  const offset = pullOffset(raw - PULL_SLOP_PX);
  return { ...state, phase: offset >= PULL_TRIGGER_PX ? "ready" : "pulling", offset };
}

/** A lifted finger syncs only from `ready`; every other phase is a scroll that never became a pull. */
export function pullEnd(state: PullState): { next: PullState; sync: boolean } {
  return { next: PULL_IDLE, sync: state.phase === "ready" };
}
