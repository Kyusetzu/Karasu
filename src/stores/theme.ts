import { create } from "zustand";
import { accentShades } from "@/lib/contrast";

export type ThemeMode = "system" | "light" | "dark";

/** Default accent + a few quick-pick swatches alongside the colour picker. */
export const DEFAULT_ACCENT = "#4b3fc7";
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

/**
 * Cover size. One token — the grid track — is the whole feature: every other
 * measurement on a cover cell already sizes off the cover, so S/M/L needs no
 * second layout and no separate compact-mode component.
 */
export type Density = "s" | "m" | "l";
export const DENSITY_STEPS: Density[] = ["s", "m", "l"];
const COVER_TRACK: Record<Density, string> = {
  s: "7.5rem",
  m: "9.375rem",
  l: "11.25rem",
};

const MODE_KEY = "karasu-theme";
const ACCENT_KEY = "karasu-accent";
const DENSITY_KEY = "karasu-density";

const isHex = (s: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);

function systemDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

/**
 * Writes the theme + accent to the document root (Tailwind reads the vars).
 *
 * Everything downstream of the chosen colour is derived here — the 400/500/600
 * ramp, a readable ink, and the two companion sheens that give panels their
 * iridescence. Deriving the sheens from the accent's own hue is what stops the
 * wash from being a fixed violet that clashes with a straw or teal accent.
 *
 * The theme is written *before* the accent is derived, because the derivation
 * depends on it: accent-as-text steps away from the page in whichever direction
 * that theme's page sits.
 */
function apply(mode: ThemeMode, accent: string, density: Density): void {
  const dark = mode === "dark" || (mode === "system" && systemDark());
  const html = document.documentElement;
  html.dataset.theme = dark ? "dark" : "light";
  html.style.setProperty("--cover-track", COVER_TRACK[density] ?? COVER_TRACK.m);

  const base = isHex(accent) ? accent : DEFAULT_ACCENT;
  const { a400, a500, a600, ink, rgb, w1, w2, hair } = accentShades(base, {
    light: !dark,
  });
  const root = html.style;
  root.setProperty("--color-accent-400", a400);
  root.setProperty("--color-accent-500", a500);
  root.setProperty("--color-accent-600", a600);
  root.setProperty("--color-accent-ink", ink);
  root.setProperty("--accent-rgb", rgb);
  root.setProperty("--w1", w1);
  root.setProperty("--w2", w2);
  root.setProperty("--hair", hair);
}

interface ThemeState {
  mode: ThemeMode;
  accent: string;
  density: Density;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: string) => void;
  setDensity: (density: Density) => void;
  init: () => void;
}

const storedDensity = (): Density => {
  const saved = localStorage.getItem(DENSITY_KEY);
  return saved === "s" || saved === "l" ? saved : "m";
};

export const useTheme = create<ThemeState>((set, get) => ({
  mode: (localStorage.getItem(MODE_KEY) as ThemeMode) || "dark",
  accent: localStorage.getItem(ACCENT_KEY) || DEFAULT_ACCENT,
  density: storedDensity(),

  setMode: (mode) => {
    localStorage.setItem(MODE_KEY, mode);
    set({ mode });
    apply(mode, get().accent, get().density);
  },

  setAccent: (accent) => {
    localStorage.setItem(ACCENT_KEY, accent);
    set({ accent });
    apply(get().mode, accent, get().density);
  },

  setDensity: (density) => {
    localStorage.setItem(DENSITY_KEY, density);
    set({ density });
    apply(get().mode, get().accent, density);
  },

  init: () => {
    apply(get().mode, get().accent, get().density);
    // Track the OS theme while in "system" mode.
    window
      .matchMedia?.("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (get().mode === "system")
          apply("system", get().accent, get().density);
      });
  },
}));
