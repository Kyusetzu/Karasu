import { useCallback, useEffect, useRef, useState } from "react";
import type { AnimationPlaybackControls, AnimationSequence } from "motion";
import { Check, MonitorPlay, RotateCcw } from "lucide-react";
import KarasuMark from "@/components/KarasuMark";
import { cn } from "@/lib/cn";
import { COPY, EASE, PHASE_SCHEDULE, T, type Phase } from "./timeline";

/**
 * The bird tracks a card.
 *
 * Four layers on a dark stage: the detection pill, the mark, an SVG overlay
 * with the sight line and the reticle, and the Now Playing card in the app's
 * own recipe. The server renders the finished scene (`data-phase="static"`);
 * with JavaScript and motion allowed, the stylesheet shows that same markup
 * as the start state, and this component drives it forward once the stage
 * is in view. The text in each layer changes with the phase (CSS, by
 * `data-phase`); the continuous parts — the landing, the line, the ring and
 * the rail — run as one `motion` sequence timed by `timeline.ts`.
 *
 * Reduced motion: the start-state rules are inside a `no-preference` media
 * query and the sequence never starts, so the finished scene simply stands.
 */

/** Where the eye sits inside the mark's box, as fractions of its width and height. */
const EYE = { x: 0.585, y: 0.345 };
/** The overlay's coordinate system before the client measures the stage. */
const DEFAULT_BOX = { w: 640, h: 400 };
/** The line as drawn against the default box; recomputed from real rects after mount. */
/** The reticle sits this far outside the badge; the line stops at its edge. */
const RETICLE_GAP = 6;
const DEFAULT_TARGET = { x: 296, y: 270, r: 28 };
const DEFAULT_LINE = sightPath({ x: 130, y: 104 }, edgeToward({ x: 130, y: 104 }, DEFAULT_TARGET));

function sightPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  // A shallow curve that leaves the eye level and drops onto the badge from
  // above — the bird looks along it rather than down it.
  const c1 = { x: from.x + (to.x - from.x) * 0.55, y: from.y };
  const c2 = { x: to.x - (to.x - from.x) * 0.15, y: to.y - (to.y - from.y) * 0.45 };
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

/** The point on the reticle's circle that faces the eye. */
function edgeToward(from: { x: number; y: number }, c: { x: number; y: number; r: number }) {
  const dx = from.x - c.x;
  const dy = from.y - c.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: c.x + (dx / len) * c.r, y: c.y + (dy / len) * c.r };
}

function motionAllowed(): boolean {
  return (
    typeof matchMedia === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function HeroScene({ className }: { className?: string }) {
  const [phase, setPhase] = useState<Phase>("static");
  const [box, setBox] = useState(DEFAULT_BOX);
  const [line, setLine] = useState(DEFAULT_LINE);
  const [target, setTarget] = useState(DEFAULT_TARGET);

  const stage = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const disc = useRef<HTMLDivElement>(null);
  const sight = useRef<SVGPathElement>(null);
  const reticle = useRef<SVGGElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  const controls = useRef<AnimationPlaybackControls | null>(null);
  const timers = useRef<number[]>([]);
  const played = useRef(false);

  // The sight line joins two HTML layers, so it is measured, not designed:
  // the eye inside the mark's box and the centre of the badge, in the
  // stage's own pixels. Re-measured on resize.
  const measure = useCallback(() => {
    const s = stage.current;
    const m = mark.current;
    const d = disc.current;
    if (!s || !m || !d) return;
    const sr = s.getBoundingClientRect();
    const mr = m.getBoundingClientRect();
    const dr = d.getBoundingClientRect();
    const from = { x: mr.left - sr.left + mr.width * EYE.x, y: mr.top - sr.top + mr.height * EYE.y };
    const centre = { x: dr.left - sr.left + dr.width / 2, y: dr.top - sr.top + dr.height / 2, r: dr.width / 2 + RETICLE_GAP };
    setBox({ w: sr.width, h: sr.height });
    setLine(sightPath(from, edgeToward(from, centre)));
    setTarget(centre);
  }, []);

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  const play = useCallback(async () => {
    // `motion` arrives only when the scene is about to run: it is the one
    // dependency the first paint does not need, and it stays out of the
    // budget the page loads with.
    const { animate } = await import("motion");
    if (!mark.current || !sight.current || !reticle.current || !ring.current || !rail.current || !chip.current) return;
    controls.current?.stop();
    clearTimers();
    setPhase("idle");

    const sequence: AnimationSequence = [
      // The raven lands: the app's `land` keyframes, by hand so the sequence owns it.
      [mark.current, { opacity: [0, 1, 1], y: ["-0.5rem", "0rem", "0rem"], scale: [0.9, 1.06, 1] }, { duration: T.landEnd / 1000, ease: EASE.outExpo, at: T.landStart / 1000 }],
      // The sight line draws from the eye to the badge.
      [sight.current, { opacity: 1 }, { duration: 0.12, at: T.sightStart / 1000 }],
      [sight.current, { pathLength: [0, 1] }, { duration: (T.sightEnd - T.sightStart) / 1000, ease: EASE.outExpo, at: T.sightStart / 1000 }],
      // The reticle settles on the badge — down from above, no bounce.
      [reticle.current, { opacity: [0, 1], y: ["-0.5rem", "0rem"] }, { duration: 0.15, ease: EASE.karasu, at: (T.sightEnd - 150) / 1000 }],
      // The countdown ring and the rail fill together.
      [ring.current, { pathLength: [0, 1] }, { duration: (T.fillEnd - T.fillStart) / 1000, ease: "linear", at: T.fillStart / 1000 }],
      [rail.current, { scaleX: [0, 1] }, { duration: (T.fillEnd - T.fillStart) / 1000, ease: "linear", at: T.fillStart / 1000 }],
      // Landed: the reticle leaves quickly, the chip pops in, the line fades to a trace.
      [reticle.current, { opacity: 0, scale: 1.15 }, { duration: 0.12, ease: EASE.exit, at: T.done / 1000 }],
      [chip.current, { opacity: [0, 1], scale: [0.97, 1] }, { duration: 0.12, ease: EASE.karasu, at: T.done / 1000 }],
      [sight.current, { opacity: 0.35 }, { duration: 0.42, ease: EASE.outExpo, at: T.done / 1000 }],
    ];
    controls.current = animate(sequence);
    for (const [at, next] of PHASE_SCHEDULE) {
      timers.current.push(window.setTimeout(() => setPhase(next), at));
    }
  }, []);

  useEffect(() => {
    measure();
    const s = stage.current;
    if (!s) return;
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    if (document.fonts?.ready) void document.fonts.ready.then(measure);
    return () => ro.disconnect();
  }, [measure]);

  // Start once, when most of the stage is on screen and motion is welcome.
  useEffect(() => {
    const s = stage.current;
    if (!s || !motionAllowed()) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (played.current) return;
        if (entries.some((e) => e.isIntersecting)) {
          played.current = true;
          measure();
          play();
          io.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(s);
    return () => io.disconnect();
  }, [measure, play]);

  useEffect(
    () => () => {
      controls.current?.stop();
      clearTimers();
    },
    [],
  );

  const done = phase === "done" || phase === "static";

  return (
    // Three rows — the pill, the mark's room, the card — so nothing can sit
    // on anything else at any size: the mark takes whatever height is left
    // between the other two. Percentages placed the layers before, and at
    // some widths the mark's tail met the card's top edge.
    // The `@container` is the wrapper, not the stage: an element cannot query
    // its own size, so the stage's taller aspect on a narrow column has to
    // read the column's width from one level up.
    <div className={cn("@container", className)}>
    <div
      ref={stage}
      data-phase={phase}
      className="hero-stage relative grid aspect-[16/10] w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden rounded-2xl p-[5%] @max-md:aspect-[6/5] @max-md:gap-2.5"
      aria-label="Karasu recognises an episode playing in mpv and updates the list"
      role="img"
    >
      {/* Row one: the detection pill, the titlebar's capsule. */}
      <div className="flex justify-center @max-md:justify-start">
        <div className="flex h-6 max-w-[80%] items-center gap-2 rounded-full border border-hair bg-surface-900 px-2.5 @max-md:max-w-[72%]">
          <span className="hero-dot size-1.5 shrink-0 rounded-full" />
          <span className="truncate text-2xs font-medium tracking-[.03em] text-ink-500">
            <span className="st st-pill-idle">{COPY.pill.idle}</span>
            <span className="st st-pill-live">{COPY.pill.live}</span>
          </span>
        </div>
      </div>

      {/* Row two: the mark, top-left of the room that is left. Brand art, never re-tinted. */}
      <div className="relative min-h-0">
        <div ref={mark} className="hero-mark absolute left-[2%] top-0 h-full max-h-44 @max-md:max-h-28">
          <KarasuMark className="h-full w-auto" />
        </div>
      </div>

      {/* The sight line and the reticle, in the stage's own pixels. */}
      <svg
        className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
        viewBox={`0 0 ${box.w} ${box.h}`}
        aria-hidden="true"
      >
        <path
          ref={sight}
          className="hero-sight"
          d={line}
          fill="none"
          stroke="var(--color-accent-400)"
          strokeWidth="1.5"
          strokeLinecap="round"
          pathLength={1}
          opacity={0.35}
        />
        {/* Positioned by the outer group's attribute; animated on the inner one, because motion
            writes a CSS transform, which would override the attribute on the same element. */}
        <g transform={`translate(${target.x} ${target.y})`}>
          <g ref={reticle} className="hero-reticle" opacity={0}>
            <circle r={target.r} fill="none" stroke="var(--color-accent-400)" strokeWidth="1.25" strokeDasharray="14 9" pathLength={100} opacity={0.9} />
          </g>
        </g>
      </svg>

      {/* Row three: the Now Playing card, the app's recipe, against the right edge. */}
      <div className="flex justify-end">
        {/* 17.5rem at the least: the eyebrow, the chip and the title all have to fit
            beside the disc, and at 15rem the stage of a 1024px window cut both. */}
        <div className="hero-card relative w-[58%] min-w-70 max-w-96 rounded-[.875rem] px-4.5 py-4 inset-well well-edge @max-md:w-full @max-md:min-w-0 @max-md:max-w-none @max-md:px-3.5 @max-md:py-3">
          <div className="flex items-start gap-3">
            <div ref={disc} className="relative grid size-11 shrink-0 place-items-center rounded-full bg-accent-600/25 text-accent-400">
              <MonitorPlay className="size-5" aria-hidden="true" />
              <svg className="absolute inset-0 size-11 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="20.5" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
                <circle ref={ring} className="hero-ring" cx="22" cy="22" r="20.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" pathLength={1} />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              {/* The chip shares the eyebrow's line, so the title keeps the card's whole width. */}
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-2xs uppercase tracking-[.09em] text-ink-600">
                  <span className="st st-eyebrow-idle">{COPY.eyebrow.idle}</span>
                  <span className="st st-eyebrow-live">{COPY.eyebrow.live}</span>
                </p>
                <span
                  ref={chip}
                  className="hero-chip shrink-0 rounded-[.625rem] border border-success/40 bg-success/10 px-2 py-0.5 font-brand text-2xs font-semibold uppercase tracking-[.16em] text-success"
                >
                  {COPY.chip}
                </span>
              </div>
              <p className="truncate text-[1.0625rem] font-semibold text-ink-100 @max-xl:text-[.9375rem]">
                {COPY.title} <span className="text-ink-500">— {COPY.episode}</span>
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-500">
                <span className="st st-status-idle">{COPY.status.idle}</span>
                <span className="st st-status-locked">{COPY.status.locked}</span>
                <span className="st st-status-filling">{COPY.status.filling}</span>
                <span className="st st-status-done inline-flex items-center gap-1.5 text-success">
                  <Check className={cn("size-3.5", done && phase !== "static" && "animate-land")} aria-hidden="true" />
                  {COPY.status.done}
                </span>
              </p>
            </div>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-800">
            <div ref={rail} className="hero-rail h-1 w-full origin-left rounded-full" />
          </div>
        </div>
      </div>

      {/* Replay, once the scene has run: bottom-left beside the card, top-right on a
          narrow stage where the card is the whole width. Hidden for the static and
          reduced-motion renders. */}
      <button
        type="button"
        onClick={play}
        className={cn(
          "absolute bottom-[5%] left-[5%] z-20 inline-flex h-7.5 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-500 transition-surface hover:bg-surface-850 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-accent-500 @max-md:bottom-auto @max-md:left-auto @max-md:right-[5%] @max-md:top-[5%]",
          phase === "done" ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={phase !== "done"}
        tabIndex={phase === "done" ? 0 : -1}
      >
        <RotateCcw className="size-3.5" aria-hidden="true" />
        <span className="@max-md:sr-only">{COPY.replay}</span>
      </button>
    </div>
    </div>
  );
}
