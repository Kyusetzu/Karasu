import { useEffect, useRef } from "react";

/**
 * Feathers, drifting down behind the page. A fixed canvas under the content
 * (`z-index: -1`, so every panel and image sits on top), a few dozen dark
 * violet feathers falling and swaying, rotating as they sway. They live in
 * the page's coordinates, not the viewport's: scroll, and they go by with
 * the text they were beside, while the ones the scroll uncovers were already
 * falling there. The pointer pushes the ones it comes near; a tap or click
 * sends the nearby ones flying and lets a handful loose from the point.
 * Three feather shapes in two tones are drawn once into sprites and stamped,
 * so a frame costs a few dozen `drawImage`s.
 *
 * Reduced motion draws one still scatter and stops. A hidden tab pauses the
 * loop. Nothing here is interactive for assistive technology: `aria-hidden`,
 * `pointer-events: none`, and the listeners sit on the window.
 */

/** Three feathers in a 120x48 box: a vane with a barbed lower edge, then the rachis. */
const SHAPES = [
  // A broad contour feather.
  {
    vane: "M6 26 C 20 8, 58 -2, 114 8 C 106 20, 92 30, 76 34 L 71 29 L 66 37 L 60 33 L 52 40 L 47 35 L 38 42 L 34 37 L 22 40 L 18 34 L 6 26 Z",
    rachis: "M6 26 C 40 22, 80 14, 114 8",
  },
  // A slim flight feather, the vane narrow on one side of the shaft.
  {
    vane: "M4 31 C 22 10, 66 -3, 116 3 C 113 10, 102 16, 88 20 L 84 16 L 78 24 L 72 20 L 60 28 L 54 24 L 42 33 L 36 29 L 22 36 L 16 32 L 4 31 Z",
    rachis: "M4 31 C 40 25, 82 12, 116 3",
  },
  // A short down feather, rounder, the barbs looser.
  {
    vane: "M8 24 C 20 6, 48 2, 78 8 C 98 12, 110 18, 114 26 C 102 34, 88 40, 72 42 L 68 36 L 60 44 L 54 38 L 44 45 L 40 39 L 28 42 L 24 36 L 14 34 L 8 24 Z",
    rachis: "M8 24 C 40 24, 80 22, 114 26",
  },
] as const;
const SPRITE_W = 120;
const SPRITE_H = 48;
/** Drawn at this many CSS px wide at `size = 1`. */
const BASE_W = 60;
/** Two violets below the accent — the flock is a shade of the ground, not a highlight on it. */
const TONES = ["#2f2890", "#211c6b"] as const;
const RACHIS_TONE = "#5f57bd";

const POINTER_RADIUS = 170;
const TAP_RADIUS = 260;
const MAX_SPAWNED = 18;
/** How far past the viewport, in page pixels, a feather may be before it is recycled. */
const BAND = 160;

interface Feather {
  x: number;
  /** In page coordinates: the viewport's top is `scrollY`. */
  y: number;
  /** Drift the feather returns to once a push has faded. */
  driftX: number;
  driftY: number;
  /** The push from the pointer or a tap, decaying. */
  pushX: number;
  pushY: number;
  rot: number;
  rotV: number;
  size: number;
  alpha: number;
  /** The sway: phase, rate and amplitude, per feather. */
  phase: number;
  rate: number;
  sway: number;
  shape: 0 | 1 | 2;
  tone: 0 | 1;
  /** Tap-born feathers fade in and are the first to be culled. */
  spawned: boolean;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function makeFeather(w: number, yMin: number, yMax: number): Feather {
  const size = rand(0.45, 1.05);
  return {
    x: rand(-40, w + 40),
    y: rand(yMin, yMax),
    driftX: rand(-8, 8),
    driftY: rand(9, 22) * (0.6 + size * 0.5),
    pushX: 0,
    pushY: 0,
    rot: rand(0, Math.PI * 2),
    rotV: rand(-0.35, 0.35),
    size,
    alpha: rand(0.22, 0.46),
    phase: rand(0, Math.PI * 2),
    rate: rand(0.5, 1.1),
    sway: rand(10, 26),
    shape: Math.floor(Math.random() * 3) as 0 | 1 | 2,
    tone: Math.random() < 0.55 ? 0 : 1,
    spawned: false,
  };
}

function makeSprite(shape: (typeof SHAPES)[number], tone: string, dpr: number): HTMLCanvasElement | null {
  const scale = (BASE_W / SPRITE_W) * dpr * 1.2;
  const c = document.createElement("canvas");
  c.width = Math.ceil(SPRITE_W * scale);
  c.height = Math.ceil(SPRITE_H * scale);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = tone;
  ctx.fill(new Path2D(shape.vane));
  ctx.strokeStyle = RACHIS_TONE;
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.7;
  ctx.stroke(new Path2D(shape.rachis));
  return c;
}

export function Feathers() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(devicePixelRatio || 1, 2);

    // sprites[shape][tone]
    const sprites = SHAPES.map((s) => TONES.map((t) => makeSprite(s, t, dpr)));
    if (sprites.some((row) => row.some((s) => !s))) return;

    let w = 0;
    let h = 0;
    let feathers: Feather[] = [];
    const pointer = { x: -1e4, y: -1e4, active: false };
    let raf = 0;
    let last = 0;
    let t = 0;

    const population = () => Math.round(Math.min(44, Math.max(12, (w * h) / 40000)));

    const resize = () => {
      w = innerWidth;
      h = innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const want = population();
      const sy = scrollY;
      const base = feathers.filter((f) => !f.spawned);
      while (base.length < want) base.push(makeFeather(w, sy - BAND, sy + h + BAND));
      feathers = base.slice(0, want).concat(feathers.filter((f) => f.spawned));
      if (reduced) draw();
    };

    const draw = () => {
      const sy = scrollY;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const f of feathers) {
        const sprite = sprites[f.shape]![f.tone]!;
        const dw = BASE_W * f.size;
        const dh = (SPRITE_H / SPRITE_W) * dw;
        ctx.globalAlpha = f.alpha;
        ctx.setTransform(dpr, 0, 0, dpr, f.x * dpr, (f.y - sy) * dpr);
        ctx.rotate(f.rot);
        ctx.drawImage(sprite, -dw / 2, -dh / 2, dw, dh);
      }
      ctx.globalAlpha = 1;
    };

    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      t += dt;
      const sy = scrollY;
      const top = sy - BAND;
      const bottom = sy + h + BAND;
      // The pointer, in page coordinates like the feathers.
      const px = pointer.x;
      const py = pointer.y + sy;
      const next: Feather[] = [];
      for (const f of feathers) {
        const swayX = Math.sin(t * f.rate + f.phase) * f.sway;
        // The pointer pushes what it comes near, harder the nearer.
        if (pointer.active) {
          const dx = f.x - px;
          const dy = f.y - py;
          const d = Math.hypot(dx, dy);
          if (d < POINTER_RADIUS && d > 0.001) {
            const k = (1 - d / POINTER_RADIUS) * 520 * dt;
            f.pushX += (dx / d) * k;
            f.pushY += (dy / d) * k;
            f.rotV += (dx > 0 ? 1 : -1) * k * 0.01;
          }
        }
        // A push fades; the drift is always there.
        f.pushX *= 1 - Math.min(1, 2.2 * dt);
        f.pushY *= 1 - Math.min(1, 2.2 * dt);
        f.rotV *= 1 - Math.min(1, 0.6 * dt);
        f.x += (f.driftX + swayX + f.pushX) * dt;
        f.y += (f.driftY + f.pushY) * dt;
        f.rot += (f.rotV + Math.cos(t * f.rate + f.phase) * 0.35) * dt;
        if (f.spawned && f.alpha < 0.42) f.alpha = Math.min(0.42, f.alpha + dt * 0.9);
        // Past the band below: it fell out, or the page scrolled up past it —
        // back in above. Past the band above, which only a scroll down does:
        // in from below, where the page it is pinned to is arriving.
        if (f.y > bottom) {
          if (f.spawned) continue;
          Object.assign(f, makeFeather(w, top, sy - 20));
        } else if (f.y < top) {
          if (f.spawned) continue;
          Object.assign(f, makeFeather(w, sy + h + 20, bottom));
        }
        if (f.x < -90) f.x = w + 60;
        else if (f.x > w + 90) f.x = -60;
        next.push(f);
      }
      feathers = next;
      draw();
    };

    const burst = (x: number, y: number) => {
      for (const f of feathers) {
        const dx = f.x - x;
        const dy = f.y - y;
        const d = Math.hypot(dx, dy);
        if (d < TAP_RADIUS && d > 0.001) {
          const k = (1 - d / TAP_RADIUS) * 380;
          f.pushX += (dx / d) * k;
          f.pushY += (dy / d) * k - 60;
          f.rotV += rand(-3, 3);
        }
      }
      const spawned = feathers.filter((f) => f.spawned).length;
      const n = Math.min(6, MAX_SPAWNED - spawned);
      for (let i = 0; i < n; i++) {
        const f = makeFeather(w, y, y);
        const a = rand(0, Math.PI * 2);
        const v = rand(160, 320);
        f.x = x;
        f.pushX = Math.cos(a) * v;
        f.pushY = Math.sin(a) * v - 80;
        f.alpha = 0.05;
        f.spawned = true;
        feathers.push(f);
      }
    };

    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    };
    const onLeave = () => {
      pointer.active = false;
    };
    const onDown = (e: PointerEvent) => {
      burst(e.clientX, e.clientY + scrollY);
    };
    const onVisibility = () => {
      if (reduced) return;
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf) {
        last = 0;
        raf = requestAnimationFrame(step);
      }
    };

    resize();
    addEventListener("resize", resize);
    if (reduced) {
      // The still scatter follows the page too.
      addEventListener("scroll", draw, { passive: true });
    } else {
      addEventListener("pointermove", onMove, { passive: true });
      addEventListener("pointerdown", onDown, { passive: true });
      addEventListener("pointercancel", onLeave);
      document.addEventListener("pointerleave", onLeave);
      document.addEventListener("visibilitychange", onVisibility);
      raf = requestAnimationFrame(step);
    }
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      removeEventListener("scroll", draw);
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerdown", onDown);
      removeEventListener("pointercancel", onLeave);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="feathers" aria-hidden="true" />;
}
