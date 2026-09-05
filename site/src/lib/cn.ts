// Copied from src/lib/utils.ts; the site keeps its own copy on purpose —
// CLAUDE.md, "The website".
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
