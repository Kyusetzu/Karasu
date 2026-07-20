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
