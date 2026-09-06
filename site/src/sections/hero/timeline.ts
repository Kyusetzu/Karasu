/**
 * The hero scene's clock, as data. Every number the scene animates by lives
 * here so the sequence, the phase changes and the reduced-motion still all
 * agree, and so the schedule can be read (and tested) without a browser.
 *
 * Phases, in order. `static` is what the server renders: it reads as the
 * finished scene, unless JavaScript is present and motion is allowed, in
 * which case the stylesheet turns it into the start state until the script
 * takes over (`html[data-js]` gate in styles/index.css).
 */
export const PHASES = ["static", "idle", "detected", "locked", "filling", "done"] as const;
export type Phase = (typeof PHASES)[number];

/** Milliseconds from the start of the sequence. */
export const T = {
  /** The raven lands — the app's own `land` keyframes, 420 ms. */
  landStart: 0,
  landEnd: 420,
  /** The detection pill wakes: grey dot to accent, "Listening" to the title. */
  detected: 420,
  /** The sight line draws from the eye to the episode badge, then the reticle settles. */
  sightStart: 600,
  sightEnd: 1300,
  locked: 1300,
  /** The countdown ring and the rail fill — a stand-in for the wait before a scrobble. */
  fillStart: 1300,
  fillEnd: 2800,
  filling: 1300,
  /** The status lands on "Updated", the chip pops in. */
  done: 2800,
  doneEnd: 3220,
} as const;

/** The phase changes the scene schedules, as (time, phase) pairs. */
export const PHASE_SCHEDULE: ReadonlyArray<readonly [number, Phase]> = [
  [T.detected, "detected"],
  [T.locked, "locked"],
  [T.filling, "filling"],
  [T.done, "done"],
];

/** The easings, spelled as the tokens the app uses — see tokens.generated.css. */
export const EASE = {
  outExpo: [0.16, 1, 0.3, 1] as [number, number, number, number],
  karasu: [0.2, 0, 0, 1] as [number, number, number, number],
  exit: [0.4, 0, 1, 1] as [number, number, number, number],
};

/** What the text in each layer says in each phase. */
export const COPY = {
  pill: {
    idle: "Listening",
    live: "mpv · Anime Title · Episode 1",
  },
  eyebrow: {
    idle: "Playing in mpv",
    live: "Watching in mpv",
  },
  title: "Anime Title",
  episode: "Episode 01",
  status: {
    idle: "Identifying…",
    locked: "Matched on your list",
    filling: "Updates in a moment",
    done: "Updated to episode 1",
  },
  chip: "Tracked",
  replay: "Play again",
} as const;
