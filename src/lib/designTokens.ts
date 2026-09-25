/** The design tokens code needs as values, and a reader for the ones that live in `index.css`. */

/** The accent a fresh install starts on, the logo's violet. */
export const DEFAULT_ACCENT = "#4b3fc7";

/** Quick-pick swatches beside the colour picker. */
export const ACCENT_PRESETS = [
  "#4b3fc7", // deep indigo — matches the logo's violet
  "#6c7fff", // indigo
  "#3b93e6", // blue
  "#46a5b3", // feather sheen
  "#34c78a", // emerald
  "#e8d48a", // pale straw
  "#f56c92", // rose
  "#ffab2e", // amber
  "#a56cff", // violet
];

/** Every custom property in a stylesheet, per block, keyed by the selector path (`@media (…) :root`) that holds it. */
export function customProperties(css: string): Map<string, Map<string, string>> {
  const blocks = new Map<string, Map<string, string>>();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const path: string[] = [];
  let buffer = "";
  const declare = () => {
    const decl = buffer.trim();
    buffer = "";
    if (!decl.startsWith("--")) return;
    const colon = decl.indexOf(":");
    if (colon === -1) return;
    const key = path.join(" ");
    if (!blocks.has(key)) blocks.set(key, new Map());
    blocks.get(key)!.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
  };
  for (const ch of text) {
    if (ch === "{") {
      path.push(buffer.trim().replace(/\s+/g, " "));
      buffer = "";
    } else if (ch === "}") {
      declare();
      path.pop();
    } else if (ch === ";") {
      declare();
    } else {
      buffer += ch;
    }
  }
  return blocks;
}
