import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** tailwind-merge told the theme's own scales, or it reads `text-ui` as a colour and drops it beside `text-ink-100`. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["ui", "title", "heading", "hero", "hero-lg"],
      radius: ["inner", "control", "panel", "sheet", "cover"],
      shadow: ["float", "sheet"],
      tracking: ["eyebrow", "lockup", "wordmark", "caption"],
    },
    classGroups: {
      z: [{ z: ["popover", "alert", "skip"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
