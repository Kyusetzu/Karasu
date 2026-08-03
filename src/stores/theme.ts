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
const REDUCE_MOTION_KEY = "karasu-reduce-motion";

/**
 * Kills every transition for one frame.
 *
 * Transitioning a `var()`-driven `color` makes the browser hold the *old*
 * computed value across a theme swap, so panels stay dark for a beat after
 * switching to light. Suspending transitions while the new values land avoids
 * animating between two palettes that were never meant to meet.
 *
 * The timeout is not redundant: `requestAnimationFrame` does not run in a
 * hidden or minimised window, and leaving the attribute on would disable every
 * transition in the app permanently.
 */
function suspendTransitions(html: HTMLElement): void {
  html.setAttribute("data-swapping", "");
  const clear = () => html.removeAttribute("data-swapping");
  requestAnimationFrame(() => requestAnimationFrame(clear));
  setTimeout(clear, 120);
}

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
function apply(
  mode: ThemeMode,
  accent: string,
  density: Density,
  reduceMotion: boolean,
): void {
  const dark = mode === "dark" || (mode === "system" && systemDark());
  const html = document.documentElement;
  suspendTransitions(html);
  html.dataset.theme = dark ? "dark" : "light";
  html.toggleAttribute("data-reduce-motion", reduceMotion);
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
  reduceMotion: boolean;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: string) => void;
  setDensity: (density: Density) => void;
  setReduceMotion: (reduceMotion: boolean) => void;
  init: () => void;
}

const storedDensity = (): Density => {
  const saved = localStorage.getItem(DENSITY_KEY);
  return saved === "s" || saved === "l" ? saved : "m";
};

export const useTheme = create<ThemeState>((set, get) => {
  /** Writes whatever the store currently holds, so no call site has to
      remember the full argument list. */
  const flush = () => {
    const { mode, accent, density, reduceMotion } = get();
    apply(mode, accent, density, reduceMotion);
  };

  /** Persist, update, and push to the document — the shape every setter has. */
  const commit = <K extends keyof ThemeState>(
    key: string,
    field: K,
    value: ThemeState[K],
  ) => {
    localStorage.setItem(key, String(value));
    set({ [field]: value } as Pick<ThemeState, K>);
    flush();
  };

  return {
    mode: (localStorage.getItem(MODE_KEY) as ThemeMode) || "dark",
    accent: localStorage.getItem(ACCENT_KEY) || DEFAULT_ACCENT,
    density: storedDensity(),
    reduceMotion: localStorage.getItem(REDUCE_MOTION_KEY) === "true",

    setMode: (mode) => commit(MODE_KEY, "mode", mode),
    setAccent: (accent) => commit(ACCENT_KEY, "accent", accent),
    setDensity: (density) => commit(DENSITY_KEY, "density", density),
    setReduceMotion: (reduceMotion) =>
      commit(REDUCE_MOTION_KEY, "reduceMotion", reduceMotion),

    init: () => {
      flush();
      // Track the OS theme while in "system" mode.
      window
        .matchMedia?.("(prefers-color-scheme: dark)")
        .addEventListener("change", () => {
          if (get().mode === "system") flush();
        });
    },
  };
});
