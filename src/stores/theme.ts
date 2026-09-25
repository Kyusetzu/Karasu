import { create } from "zustand";
import { accentShades } from "@/lib/contrast";
import { DEFAULT_ACCENT } from "@/lib/designTokens";
import type { MediaListStatus } from "@/api/types";
import {
  STATUS_COLOR_ORDER,
  isStatusHex,
  normalizeStatusColors,
  statusVar,
  type StatusPalette,
} from "@/lib/statusColors";

export type ThemeMode = "system" | "light" | "dark";

/** How much the dense screens (calendar, local library, digests) spread out; "compact" is the look they always had. */
export type Density = "compact" | "comfortable" | "spacious";
export const DENSITIES: readonly Density[] = ["compact", "comfortable", "spacious"];
const isDensity = (v: unknown): v is Density => (DENSITIES as readonly unknown[]).includes(v);

/** Covers per row, the grid's one token; the default is UA-keyed because this store boots before `platform_info`. */
export const COVER_COLS_MIN = 1;
export const COVER_COLS_MAX = 40;
const clampCols = (n: number): number =>
  Math.min(COVER_COLS_MAX, Math.max(COVER_COLS_MIN, Math.round(n)));
const narrowShell = (): boolean =>
  window.matchMedia?.("(max-width: 767px)").matches ?? false;
const defaultCoverCols = (): number =>
  /android/i.test(navigator.userAgent) ? 4 : 10;

const MODE_KEY = "karasu-theme";
const ACCENT_KEY = "karasu-accent";
const ACCENT_SOURCE_KEY = "karasu-accent-source";
const COVER_COLS_KEY = "karasu-cover-cols";
/** The pre-slider setting, read once for migration and then deleted. */
const DENSITY_KEY = "karasu-density";
const REDUCE_MOTION_KEY = "karasu-reduce-motion";
/** Not `karasu-density`, which held the old s/m/l cover setting and would read back as a stray value. */
const UI_DENSITY_KEY = "karasu-ui-density";
const STATUS_COLORS_KEY = "karasu-status-colors";

/** Kills every transition for one frame; keep both reflows and the timeout, or var() colours hold the old value. */
function suspendTransitions(html: HTMLElement): void {
  html.setAttribute("data-swapping", "");
  void html.offsetHeight;
  const clear = () => html.removeAttribute("data-swapping");
  requestAnimationFrame(() => requestAnimationFrame(clear));
  setTimeout(clear, 120);
}

const isHex = (s: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s);

export type AccentSource = "custom" | "system";

/** Who answers "what colour is the system's accent"; main.tsx plugs the Tauri command in, tests plug in a stub. */
let systemAccentProvider: () => Promise<string | null> = () => Promise.resolve(null);
export const setSystemAccentProvider = (fn: () => Promise<string | null>) => {
  systemAccentProvider = fn;
};

/** The colour the ramp is derived from: the system's while that source is chosen and known, the user's otherwise. */
export const effectiveAccent = (source: AccentSource, accent: string, systemAccent: string | null): string =>
  source === "system" && systemAccent ? systemAccent : accent;

function systemDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
}

/** Writes the theme and the accent's derived ramp to the root; the theme goes first because the derivation reads it. */
function apply(
  mode: ThemeMode,
  accent: string,
  coverCols: number,
  reduceMotion: boolean,
  statusColors: StatusPalette,
  density: Density,
): void {
  const dark = mode === "dark" || (mode === "system" && systemDark());
  const html = document.documentElement;
  suspendTransitions(html);
  html.dataset.theme = dark ? "dark" : "light";
  html.toggleAttribute("data-reduce-motion", reduceMotion);
  html.style.setProperty("--cover-cols", String(clampCols(coverCols)));
  // The dense screens read their sizes from the tokens index.css keys on this attribute.
  html.dataset.density = density;

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

  // Variables so a swap repaints every ring without a re-render; flat fills, so not shaded through `accentShades`.
  for (const status of STATUS_COLOR_ORDER) {
    root.setProperty(statusVar(status), statusColors[status]);
  }

  // Keep this reflow while `data-swapping` is on, or every swap renders the previous palette.
  void html.offsetHeight;
}

interface ThemeState {
  mode: ThemeMode;
  accent: string;
  /** "system" follows the OS accent; `accent` is kept underneath so switching back costs nothing. */
  accentSource: AccentSource;
  /** The OS accent as last read, null until asked or where the platform has none. */
  systemAccent: string | null;
  coverCols: number;
  reduceMotion: boolean;
  density: Density;
  /** One colour per list status — see `lib/statusColors`. */
  statusColors: StatusPalette;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: string) => void;
  setAccentSource: (source: AccentSource) => void;
  /** Re-reads the OS accent; the shell calls it on focus, since Windows lets the colour change while the app runs. */
  refreshSystemAccent: () => Promise<void>;
  setCoverCols: (coverCols: number) => void;
  setReduceMotion: (reduceMotion: boolean) => void;
  setDensity: (density: Density) => void;
  /** Sets one status's colour, leaving the other five alone. */
  setStatusColor: (status: MediaListStatus, hex: string) => void;
  resetStatusColors: () => void;
  init: () => void;
}

const storedCoverCols = (): number => {
  const saved = Number(localStorage.getItem(COVER_COLS_KEY));
  if (Number.isFinite(saved) && saved > 0) return clampCols(saved);
  // Migrate the old s/m/l track setting once, mapping it to the column count it resolved to on each shell.
  const density = localStorage.getItem(DENSITY_KEY);
  if (density === "s" || density === "m" || density === "l") {
    localStorage.removeItem(DENSITY_KEY);
    const map = narrowShell()
      ? { s: 3, m: 2, l: 2 }
      : { s: 10, m: 8, l: 7 };
    const cols = map[density];
    try {
      localStorage.setItem(COVER_COLS_KEY, String(cols));
    } catch {
      // The same trade every other setting here makes silently.
    }
    return cols;
  }
  return defaultCoverCols();
};

/** Validated, not cast, or a stale value silently lands on light, the opposite of the documented default. */
const storedMode = (): ThemeMode => {
  const saved = localStorage.getItem(MODE_KEY);
  return saved === "light" || saved === "system" ? saved : "dark";
};

const storedAccent = (): string => {
  const saved = localStorage.getItem(ACCENT_KEY);
  return saved && isHex(saved) ? saved : DEFAULT_ACCENT;
};

const storedAccentSource = (): AccentSource =>
  localStorage.getItem(ACCENT_SOURCE_KEY) === "system" ? "system" : "custom";

/** The one non-scalar setting; `commit` stringifies, and an object would read back as the defaults forever. */
const storedDensity = (): Density => {
  const raw = localStorage.getItem(UI_DENSITY_KEY);
  return isDensity(raw) ? raw : "compact";
};

const storedStatusColors = (): StatusPalette => {
  try {
    return normalizeStatusColors(JSON.parse(localStorage.getItem(STATUS_COLORS_KEY) ?? "null"));
  } catch {
    return normalizeStatusColors(null);
  }
};

export const useTheme = create<ThemeState>((set, get) => {
  /** Writes whatever the store currently holds, so no call site repeats the argument list. */
  const flush = () => {
    const { mode, accent, accentSource, systemAccent, coverCols, reduceMotion, statusColors, density } = get();
    apply(mode, effectiveAccent(accentSource, accent, systemAccent), coverCols, reduceMotion, statusColors, density);
  };

  /** The palette's own writer, JSON rather than `commit`; the `try` because private-mode storage throws on write. */
  const writeStatusColors = (palette: StatusPalette) => {
    try {
      localStorage.setItem(STATUS_COLORS_KEY, JSON.stringify(palette));
    } catch {
      // Same trade every other setting here makes silently.
    }
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
    mode: storedMode(),
    accent: storedAccent(),
    accentSource: storedAccentSource(),
    systemAccent: null,
    coverCols: storedCoverCols(),
    reduceMotion: localStorage.getItem(REDUCE_MOTION_KEY) === "true",
    density: storedDensity(),
    statusColors: storedStatusColors(),

    setMode: (mode) => commit(MODE_KEY, "mode", mode),
    setAccent: (accent) => commit(ACCENT_KEY, "accent", accent),
    setAccentSource: (source) => commit(ACCENT_SOURCE_KEY, "accentSource", source),
    refreshSystemAccent: async () => {
      const read = await systemAccentProvider().catch(() => null);
      const systemAccent = read && isHex(read) ? read.toLowerCase() : null;
      if (systemAccent === get().systemAccent) return;
      set({ systemAccent });
      flush();
    },
    setCoverCols: (coverCols) =>
      commit(COVER_COLS_KEY, "coverCols", clampCols(coverCols)),
    setReduceMotion: (reduceMotion) =>
      commit(REDUCE_MOTION_KEY, "reduceMotion", reduceMotion),
    setDensity: (density) => commit(UI_DENSITY_KEY, "density", density),

    // Not via `commit`, which stringifies; per status, so a stale copy of the other five cannot quietly undo them.
    setStatusColor: (status, hex) => {
      if (!isStatusHex(hex)) return;
      const statusColors = { ...get().statusColors, [status]: hex };
      writeStatusColors(statusColors);
      set({ statusColors });
      flush();
    },

    resetStatusColors: () => {
      const statusColors = normalizeStatusColors(null);
      writeStatusColors(statusColors);
      set({ statusColors });
      flush();
    },

    init: () => {
      flush();
      void get().refreshSystemAccent();
      window.addEventListener("focus", () => {
        if (get().accentSource === "system") void get().refreshSystemAccent();
      });
      // Track the OS theme while in "system" mode.
      window
        .matchMedia?.("(prefers-color-scheme: dark)")
        .addEventListener("change", () => {
          if (get().mode === "system") flush();
        });
    },
  };
});
