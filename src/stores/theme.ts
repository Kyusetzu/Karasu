import { create } from "zustand";

export type ThemeMode = "system" | "light" | "dark";

/** Accent presets: [accent-400, accent-500, accent-600]. */
export const ACCENTS: Record<string, [string, string, string]> = {
  indigo: ["#8b9dff", "#6c7fff", "#5563e8"], // default
  blue: ["#5eb0ef", "#3b93e6", "#2f77c4"],
  emerald: ["#5bd6a0", "#34c78a", "#2aa876"],
  rose: ["#ff8fab", "#f56c92", "#e04d78"],
  amber: ["#ffc04d", "#ffab2e", "#e8890f"],
  violet: ["#c08bff", "#a56cff", "#8b4de8"],
};

const MODE_KEY = "karasu-theme";
const ACCENT_KEY = "karasu-accent";

function systemDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

/** Writes the theme + accent to the document root (Tailwind reads the vars). */
function apply(mode: ThemeMode, accent: string): void {
  const dark = mode === "dark" || (mode === "system" && systemDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const [a400, a500, a600] = ACCENTS[accent] ?? ACCENTS.indigo;
  const root = document.documentElement.style;
  root.setProperty("--color-accent-400", a400);
  root.setProperty("--color-accent-500", a500);
  root.setProperty("--color-accent-600", a600);
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
  accent: localStorage.getItem(ACCENT_KEY) || "indigo",

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
