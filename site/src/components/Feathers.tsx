import { useEffect, useRef } from "react";

/**
 * Feathers, drifting down behind the page. A fixed canvas under the content
 * (`z-index: -1`, so every panel and image sits on top), a few dozen dark
 * violet feathers falling and swaying, rotating as they sway. The pointer
 * pushes the ones it comes near; a tap or click sends the nearby ones flying
 * and lets a handful loose from the point. The vane is drawn once into a
 * sprite and stamped, so a frame costs a few dozen `drawImage`s.
 *
 * Reduced motion draws one still scatter and stops. A hidden tab pauses the
 * loop. Nothing here is interactive for assistive technology: `aria-hidden`,
 * `pointer-events: none`, and the listeners sit on the window.
 */

/** The feather, in a 120x48 box: the vane with a barbed lower edge, then the rachis. */
const VANE =
  "M6 26 C 20 8, 58 -2, 114 8 C 106 20, 92 30, 76 34 L 71 29 L 66 37 L 60 33 L 52 40 L 47 35 L 38 42 L 34 37 L 22 40 L 18 34 L 6 26 Z";
const RACHIS = "M6 26 C 40 22, 80 14, 114 8";
const SPRITE_W = 120;
const SPRITE_H = 48;
/** Drawn at this many CSS px wide at `size = 1`. */
const BASE_W = 60;
/** Two violets, the accent's pressed shade and something deeper for the back of the flock. */
const TONES = ["#3f35a7", "#2b2578"] as const;
const RACHIS_TONE = "#8077d7";

const POINTER_RADIUS = 170;
const TAP_RADIUS = 260;
const MAX_SPAWNED = 18;

interface Feather {
  x: number;
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
  tone: 0 | 1;
  /** Tap-born feathers fade in and are the first to be culled. */
  spawned: boolean;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function makeFeather(w: number, h: number, fromTop: boolean): Feather {
  const size = rand(0.45, 1.05);
  return {
    x: rand(-40, w + 40),
    y: fromTop ? rand(-140, -40) : rand(-40, h + 40),
    driftX: rand(-8, 8),
    driftY: rand(9, 22) * (0.6 + size * 0.5),
    pushX: 0,
    pushY: 0,
    rot: rand(0, Math.PI * 2),
    rotV: rand(-0.35, 0.35),
    size,
    alpha: rand(0.28, 0.6),
    phase: rand(0, Math.PI * 2),
    rate: rand(0.5, 1.1),
    sway: rand(10, 26),
    tone: Math.random() < 0.55 ? 0 : 1,
    spawned: false,
  };
}

function makeSprite(dpr: number): HTMLCanvasElement | null {
  const scale = (BASE_W / SPRITE_W) * dpr * 1.2;
  const c = document.createElement("canvas");
  c.width = Math.ceil(SPRITE_W * scale);
  c.height = Math.ceil(SPRITE_H * scale);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  // One sprite per tone would cost a second canvas for a colour the eye
  // barely tells apart at this alpha; the tone is a fill-style swap instead.
  return c;
}

function paintSprite(c: HTMLCanvasElement, tone: string, dpr: number) {
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const scale = (BASE_W / SPRITE_W) * dpr * 1.2;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, SPRITE_W, SPRITE_H);
  ctx.fillStyle = tone;
  ctx.fill(new Path2D(VANE));
  ctx.strokeStyle = RACHIS_TONE;
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.75;
  ctx.stroke(new Path2D(RACHIS));
  ctx.globalAlpha = 1;
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

    const sprites = TONES.map((t) => {
      const c = makeSprite(dpr);
      if (c) paintSprite(c, t, dpr);
      return c;
    });
    if (sprites.some((s) => !s)) return;

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
      const base = feathers.filter((f) => !f.spawned);
      while (base.length < want) base.push(makeFeather(w, h, false));
      feathers = base.slice(0, want).concat(feathers.filter((f) => f.spawned));
      if (reduced) draw();
    };

    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const f of feathers) {
        const sprite = sprites[f.tone]!;
        const dw = BASE_W * f.size;
        const dh = (SPRITE_H / SPRITE_W) * dw;
        ctx.globalAlpha = f.alpha;
        ctx.setTransform(dpr, 0, 0, dpr, f.x * dpr, f.y * dpr);
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
      const next: Feather[] = [];
      for (const f of feathers) {
        const swayX = Math.sin(t * f.rate + f.phase) * f.sway;
        // The pointer pushes what it comes near, harder the nearer.
        if (pointer.active) {
          const dx = f.x - pointer.x;
          const dy = f.y - pointer.y;
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
        if (f.spawned && f.alpha < 0.55) f.alpha = Math.min(0.55, f.alpha + dt * 0.9);
        // Off the bottom: back in at the top. Off a side: in from the other.
        if (f.y > h + 80) {
          if (f.spawned) continue;
          Object.assign(f, makeFeather(w, h, true));
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
        const f = makeFeather(w, h, false);
        const a = rand(0, Math.PI * 2);
        const v = rand(160, 320);
        f.x = x;
        f.y = y;
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
      burst(e.clientX, e.clientY);
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
    if (!reduced) {
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
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerdown", onDown);
      removeEventListener("pointercancel", onLeave);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="feathers" aria-hidden="true" />;
}
