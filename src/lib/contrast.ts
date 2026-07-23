/**
 * Small colour-contrast helpers so accent-coloured surfaces always carry
 * readable text, no matter how light or dark the user's accent is.
 */

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

/** Black or white — whichever is more readable on the given background. */
export function readableInk(hexBg: string): "#000000" | "#ffffff" {
  return relativeLuminance(hexBg) > 0.45 ? "#000000" : "#ffffff";
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
  a400: string;
  a500: string;
  a600: string;
  /** Readable text colour for accent-filled surfaces. */
  ink: string;
}

/** Derive the 400/500/600 accent ramp + a readable ink from a base colour. */
export function accentShades(base: string): AccentShades {
  return {
    a400: mix(base, "#ffffff", 0.2),
    a500: base,
    a600: mix(base, "#000000", 0.16),
    ink: readableInk(base),
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
