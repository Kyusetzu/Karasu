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

/** WCAG contrast ratio between two colours, 1 … 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Black or white — whichever genuinely has more contrast on the background.
 *
 * This used to be `luminance > 0.45`, which is a much higher bar than the
 * arithmetic supports: the two ratios actually cross at luminance ≈ 0.179, so
 * everything between there and 0.45 was being given white text when black was
 * the more readable choice. On the app's own accent presets that was not a
 * near-miss — white on `#46a5b3` measures 2.88:1 and on `#3b93e6` 3.23:1, both
 * below the 4.5:1 floor, where black would have given 7.29:1 and 6.50:1.
 */
export function readableInk(hexBg: string): "#000000" | "#ffffff" {
  return contrastRatio(hexBg, "#000000") >= contrastRatio(hexBg, "#ffffff")
    ? "#000000"
    : "#ffffff";
}

/**
 * Rotates a colour's hue, holding saturation above a floor.
 *
 * The floor is what makes the companion sheens work for *any* accent: a
 * near-grey base has almost no saturation to rotate, so without it the wash
 * would be a second grey and the panels would go flat. `saturationFloor` is a
 * 0…1 fraction, unlike `Hsv.s` which is 0…100.
 */
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
  /** Hairline border colour, already an `rgba()` string. */
  hair: string;
}

export interface AccentContext {
  /** Light theme flips which direction the shades are pulled. */
  light?: boolean;
  /** Page background — what accent *text* has to be readable on. */
  surface950?: string;
  /** Panel fill — what an accent *fill* has to stay visible against. */
  surface900?: string;
}

/**
 * Derives every accent-dependent value from the one colour the user picked.
 *
 * All of it must stay computed: the point is that any colour on the wheel is
 * safe. The companion sheens (`w1`/`w2`) are the accent's own hue rotated, so
 * an indigo accent throws violet, a straw one throws warm amber and a teal one
 * throws green-blue. Hardcoding any of it reintroduces the failure where a pale
 * accent produced unreadable text while the panel wash stayed violet.
 */
export function accentShades(
  base: string,
  { light = false, surface950, surface900 }: AccentContext = {},
): AccentShades {
  const toward = light ? "#000000" : "#ffffff";
  const page = surface950 ?? (light ? "#f4f6f9" : "#0b0d12");
  const panel = surface900 ?? (light ? "#ffffff" : "#11141b");

  // Accent-as-text: step away from the page until it clears 4.5:1. The bound
  // matters — a base that can never reach it (a mid grey on a mid page) would
  // otherwise spin here.
  let a400 = mix(base, toward, 0.2);
  for (let i = 0; i < 20 && contrastRatio(a400, page) < 4.5; i++) {
    a400 = mix(a400, toward, 0.12);
  }

  // Accent-as-fill: only light theme needs help, where a very pale accent
  // would otherwise be a white square on a white panel.
  const a500 =
    light && contrastRatio(base, panel) < 3 ? mix(base, "#000000", 0.22) : base;

  const w1 = rgbTriplet(hueRotate(base, -28, 0.45));

  return {
    a400,
    a500,
    a600: mix(a500, "#000000", 0.16),
    ink: readableInk(a500),
    rgb: rgbTriplet(a500),
    w1,
    w2: rgbTriplet(hueRotate(base, 46, 0.45)),
    hair: `rgba(${w1}, ${light ? 0.16 : 0.11})`,
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
