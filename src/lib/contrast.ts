/** Colour-contrast helpers so accent-coloured surfaces always carry readable text, whatever accent the user picks. */

/** Parse an `#rgb`/`#rrggbb` string to [r,g,b] in 0…255 (fallback: black). */
export function parseHex(hex: string): [number, number, number] {
  const c = hex.replace("#", "").trim();
  const n =
    c.length === 3
      ? c.split("").map((x) => x + x).join("")
      : c.padEnd(6, "0").slice(0, 6);
  const int = Number.parseInt(n, 16);
  if (Number.isNaN(int)) return [0, 0, 0];
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function relativeLuminance(hex: string): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = parseHex(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours, 1 … 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The two inks `readableInk` chooses between. */
export interface InkPair {
  dark: string;
  light: string;
}

/** Maximum contrast, but harsh — use where nothing softer will do. */
export const PURE_INK: InkPair = { dark: "#000000", light: "#ffffff" };

/** The two ends of the app's own ink scale, not theme-dependent: the accent fill's luminance decides, not the page. */
export const UI_INK: InkPair = { dark: "#1a1e27", light: "#eef1f6" };

/** Whichever ink has more contrast on the background; compare the two ratios, never a luminance threshold. */
export function readableInk(hexBg: string, ink: InkPair = PURE_INK): string {
  return contrastRatio(hexBg, ink.dark) >= contrastRatio(hexBg, ink.light)
    ? ink.dark
    : ink.light;
}

/** Rotates a hue holding saturation above a 0..1 floor, so a near-grey accent still yields a coloured sheen. */
export function hueRotate(
  hex: string,
  degrees: number,
  saturationFloor = 0,
): string {
  const hsv = hexToHsv(hex);
  return hsvToHex({
    h: (((hsv.h + degrees) % 360) + 360) % 360,
    s: Math.max(hsv.s, saturationFloor * 100),
    v: hsv.v,
  });
}

/** `"r, g, b"` — for `rgba(var(--token), α)`, where the alpha varies per use. */
export function rgbTriplet(hex: string): string {
  return parseHex(hex).join(", ");
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((x) => clamp(x).toString(16).padStart(2, "0")).join("")}`;
}

/** Blend `hex` toward `target` by `amount` (0…1). */
export function mix(hex: string, target: string, amount: number): string {
  const a = parseHex(hex);
  const b = parseHex(target);
  return toHex([
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ]);
}

export interface AccentShades {
  /** Accent as *text on a surface* — pulled away from it, forced past 4.5:1. */
  a400: string;
  /** Accent as a *fill*. The base, unless light theme needs it darkened. */
  a500: string;
  a600: string;
  /** Readable text colour for accent-filled surfaces. */
  ink: string;
  /** `"r, g, b"` of a500, for `rgba(var(--accent-rgb), α)`. */
  rgb: string;
  /** Cooler companion sheen, as a triplet. */
  w1: string;
  /** Warmer companion sheen, as a triplet. */
  w2: string;
  /** Hairline border colour, a neutral `rgba()` string; the accent no longer tints it. */
  hair: string;
}

export interface AccentContext {
  /** Light theme flips which direction the shades are pulled. */
  light?: boolean;
  /** Page background — what accent *text* has to be readable on. */
  surface950?: string;
  /** Panel fill — what an accent *fill* has to stay visible against. */
  surface900?: string;
  /** Inks to choose between for text on the fill. Defaults to the UI pair. */
  ink?: InkPair;
  /** High contrast lifts accent text and the fill's ink to 7:1 and makes the hairline the strong border. */
  contrast?: ContrastLevel;
}

/** What the Appearance setting stores: follow the OS, or hold one level whatever the OS says. */
export type ContrastMode = "system" | "standard" | "high";
export type ContrastLevel = "standard" | "high";
export const CONTRAST_MODES: readonly ContrastMode[] = ["system", "standard", "high"];

/** The level a mode resolves to; the OS's `prefers-contrast: more` answers only for "system". */
export function resolveContrast(mode: ContrastMode, osPrefersMore: boolean): ContrastLevel {
  if (mode === "system") return osPrefersMore ? "high" : "standard";
  return mode;
}

/** Derives every accent-dependent value from the one colour picked; keep all of it computed so any hue is safe. */
export function accentShades(
  base: string,
  { light = false, surface950, surface900, ink = UI_INK, contrast = "standard" }: AccentContext = {},
): AccentShades {
  const high = contrast === "high";
  const toward = light ? "#000000" : "#ffffff";
  const page = surface950 ?? (high ? (light ? "#ffffff" : "#050608") : light ? "#f4f6f8" : "#0b0d12");
  const panel = surface900 ?? (high ? (light ? "#ffffff" : "#090b0f") : light ? "#ffffff" : "#12141a");
  const textTarget = high ? 7 : 4.5;

  // Accent-as-text: step away from the page until it is readable; keep the bound, or an unreachable base spins here.
  let a400 = mix(base, toward, 0.2);
  for (let i = 0; i < 30 && contrastRatio(a400, page) < textTarget; i++) {
    a400 = mix(a400, toward, 0.12);
  }

  // Accent-as-fill: only light theme needs help, where a pale accent would be a white square on a white panel.
  let a500 =
    light && contrastRatio(base, panel) < 3 ? mix(base, "#000000", 0.22) : base;
  const fillInk = readableInk(a500, high ? PURE_INK : ink);
  // High contrast moves the fill away from its ink instead, until the label on it reaches 7:1.
  const away = contrastRatio(fillInk, "#000000") > contrastRatio(fillInk, "#ffffff") ? "#000000" : "#ffffff";
  if (high) {
    for (let i = 0; i < 30 && contrastRatio(a500, fillInk) < 7; i++) a500 = mix(a500, away, 0.08);
  }

  const w1 = rgbTriplet(hueRotate(base, -28, 0.45));

  return {
    a400,
    a500,
    a600: mix(a500, high ? away : "#000000", 0.16),
    ink: fillInk,
    rgb: rgbTriplet(a500),
    w1,
    w2: rgbTriplet(hueRotate(base, 46, 0.45)),
    hair: high ? "var(--color-surface-600)" : light ? "rgba(16, 20, 30, 0.1)" : "rgba(255, 255, 255, 0.075)",
  };
}

export interface Hsv {
  h: number; // 0…360
  s: number; // 0…100
  v: number; // 0…100
}

/** Convert a hex colour to HSV, for driving a saturation/value + hue picker. */
export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = parseHex(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

/** Convert HSV back to a `#rrggbb` hex colour. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const sN = s / 100;
  const vN = v / 100;
  const c = vN * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vN - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}
