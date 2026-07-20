import { create } from "zustand";
import { accentShades } from "@/lib/contrast";

export type ThemeMode = "system" | "light" | "dark";

/** Default accent + a few quick-pick swatches alongside the colour picker. */
export const DEFAULT_ACCENT = "#6c7fff";
export const ACCENT_PRESETS = [
  "#6c7fff", // indigo
  "#3b93e6", // blue
  "#34c78a", // emerald
  "#f56c92", // rose
  "#ffab2e", // amber
  "#a56cff", // violet
];

const MODE_KEY = "karasu-theme";
const ACCENT_KEY = "karasu-accent";

const isHex = (s: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);

function systemDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

/**
 * Writes the theme + accent to the document root (Tailwind reads the vars).
 * The 400/500/600 ramp and a readable `--color-accent-ink` are derived from
 * the single chosen colour, so any accent — however light or dark — keeps
 * accent-filled controls legible.
 */
function apply(mode: ThemeMode, accent: string): void {
  const dark = mode === "dark" || (mode === "system" && systemDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const base = isHex(accent) ? accent : DEFAULT_ACCENT;
  const { a400, a500, a600, ink } = accentShades(base);
  const root = document.documentElement.style;
  root.setProperty("--color-accent-400", a400);
  root.setProperty("--color-accent-500", a500);
  root.setProperty("--color-accent-600", a600);
  root.setProperty("--color-accent-ink", ink);
}

interface ThemeState {
  mode: ThemeMode;
  accent: string;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: string) => void;
  init: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  mode: (localStorage.getItem(MODE_KEY) as ThemeMode) || "dark",
  accent: localStorage.getItem(ACCENT_KEY) || DEFAULT_ACCENT,

  setMode: (mode) => {
    localStorage.setItem(MODE_KEY, mode);
    set({ mode });
    apply(mode, get().accent);
  },

  setAccent: (accent) => {
    localStorage.setItem(ACCENT_KEY, accent);
    set({ accent });
    apply(get().mode, accent);
  },

  init: () => {
    apply(get().mode, get().accent);
    // Track the OS theme while in "system" mode.
    window
      .matchMedia?.("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (get().mode === "system") apply("system", get().accent);
      });
  },
}));
