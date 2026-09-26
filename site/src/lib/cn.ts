// Copied from src/lib/utils.ts; the site keeps its own copy on purpose —
// CLAUDE.md, "The website".
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge told the theme's own scales — the app's and the site's —
 * or it reads `text-ui` as a colour and drops it beside `text-ink-100`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["ui", "title", "heading", "hero", "hero-lg", "body", "h2", "h3", "display", "cta", "lede"],
      radius: ["inner", "control", "panel", "sheet", "cover", "mark", "device"],
      shadow: ["float", "sheet", "shot", "shot-lift"],
      tracking: ["eyebrow", "lockup", "wordmark", "caption"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
