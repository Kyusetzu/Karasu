import { create } from "zustand";
import { accentShades } from "@/lib/contrast";
import type { MediaListStatus } from "@/api/types";
import {
  STATUS_COLOR_ORDER,
  isStatusHex,
  normalizeStatusColors,
  statusVar,
  type StatusPalette,
} from "@/lib/statusColors";

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
 * Covers per row. One token — the column count — is the whole feature: the
 * tracks are equal flexible columns, so the covers scale to share the width
 * and every other measurement on a cover cell sizes off the cover.
 *
 * A count, not a track size, after the second device round: fixed-size tracks
 * meant the setting could not tell "medium" from "large" on a phone (both
 * resolved to two columns), and what the maintainer actually wanted to steer
 * was how many covers share a row. The default differs by form factor — more
 * on a monitor, fewer on a phone — measured at first run by the same 767px
 * boundary the shell uses, because the two installs have separate storage and
 * a desktop window is wide at startup even when it can be squeezed later.
 */
export const COVER_COLS_MIN = 2;
export const COVER_COLS_MAX = 40;
const clampCols = (n: number): number =>
  Math.min(COVER_COLS_MAX, Math.max(COVER_COLS_MIN, Math.round(n)));
const narrowShell = (): boolean =>
  window.matchMedia?.("(max-width: 767px)").matches ?? false;
const defaultCoverCols = (): number => (narrowShell() ? 2 : 8);

const MODE_KEY = "karasu-theme";
const ACCENT_KEY = "karasu-accent";
const COVER_COLS_KEY = "karasu-cover-cols";
/** The pre-slider setting, read once for migration and then deleted. */
const DENSITY_KEY = "karasu-density";
const REDUCE_MOTION_KEY = "karasu-reduce-motion";
const STATUS_COLORS_KEY = "karasu-status-colors";

/**
 * Kills every transition for one frame.
 *
 * Transitioning a `var()`-driven colour makes the browser hold the *old*
 * computed value across a theme swap — and it holds it **permanently**, not for
 * a beat: a panel with `transition-surface` keeps its dark fill in light theme
 * until something else forces it to re-resolve. Measured directly: two sibling
 * divs both `bg-surface-850`, only one with `transition-surface`, and after the
 * swap the plain one reads `#eef1f5` while the transitioned one is still
 * `#161a23`.
 *
 * **Two forced reflows are the fix, and neither is decoration.** Everything in
 * one task collapses into a single style recalculation, so:
 *
 * 1. Without the flush *here*, the browser decides whether to start a
 *    transition against the values in effect before the task — which still had
 *    `background-color` in `transition-property`. The transition starts anyway
 *    and the guard does nothing.
 * 2. Without the flush at the end of {@link apply}, the recalculation that
 *    resolves the new palette is deferred past the frame that removes the
 *    attribute, so it lands with transitions live again. Measured: every swap
 *    then renders the *previous* swap's palette, one behind forever.
 *
 * The timeout is not redundant either: `requestAnimationFrame` does not run in
 * a hidden or minimised window, and leaving the attribute on would disable
 * every transition in the app permanently.
 */
function suspendTransitions(html: HTMLElement): void {
  html.setAttribute("data-swapping", "");
  void html.offsetHeight;
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
  coverCols: number,
  reduceMotion: boolean,
  statusColors: StatusPalette,
): void {
  const dark = mode === "dark" || (mode === "system" && systemDark());
  const html = document.documentElement;
  suspendTransitions(html);
  html.dataset.theme = dark ? "dark" : "light";
  html.toggleAttribute("data-reduce-motion", reduceMotion);
  html.style.setProperty("--cover-cols", String(clampCols(coverCols)));

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

  // Written as variables so a palette change repaints every cover ring without
  // re-rendering a single component — the same trick the accent uses. Not
  // derived through `accentShades`: these are read as flat fills at ring width
  // rather than as a surface with text on it, and shading them toward the page
  // would pull six deliberately distinct hues toward each other.
  for (const status of STATUS_COLOR_ORDER) {
    root.setProperty(statusVar(status), statusColors[status]);
  }

  // Resolve the new palette while `data-swapping` is still on — see
  // `suspendTransitions`. Deferring this past the frame that clears the
  // attribute leaves every swap rendering the previous one's colours.
  void html.offsetHeight;
}

interface ThemeState {
  mode: ThemeMode;
  accent: string;
  coverCols: number;
  reduceMotion: boolean;
  /** One colour per list status — see `lib/statusColors`. */
  statusColors: StatusPalette;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: string) => void;
  setCoverCols: (coverCols: number) => void;
  setReduceMotion: (reduceMotion: boolean) => void;
  /** Sets one status's colour, leaving the other five alone. */
  setStatusColor: (status: MediaListStatus, hex: string) => void;
  resetStatusColors: () => void;
  init: () => void;
}

const storedCoverCols = (): number => {
  const saved = Number(localStorage.getItem(COVER_COLS_KEY));
  if (Number.isFinite(saved) && saved > 0) return clampCols(saved);
  // Migrate the old s/m/l track setting once, keeping its intent: on a phone
  // small really did mean three-across and the other two meant two; on a
  // desktop the mapping is the column count a typical window resolved to.
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

/**
 * Validated, not cast. `apply` treats anything that is not `dark` or `system`
 * as light, so a stale or hand-edited value silently lands on the *opposite*
 * of the documented default while the Settings radio group shows nothing
 * selected at all.
 */
const storedMode = (): ThemeMode => {
  const saved = localStorage.getItem(MODE_KEY);
  return saved === "light" || saved === "system" ? saved : "dark";
};

const storedAccent = (): string => {
  const saved = localStorage.getItem(ACCENT_KEY);
  return saved && isHex(saved) ? saved : DEFAULT_ACCENT;
};

/**
 * The one setting here that is not a scalar, which matters: `commit` below
 * writes `String(value)`, and an object would land in localStorage as
 * `[object Object]` and read back as the defaults forever — silently, since
 * `normalizeStatusColors` repairs whatever it is given.
 */
const storedStatusColors = (): StatusPalette => {
  try {
    return normalizeStatusColors(JSON.parse(localStorage.getItem(STATUS_COLORS_KEY) ?? "null"));
  } catch {
    return normalizeStatusColors(null);
  }
};

export const useTheme = create<ThemeState>((set, get) => {
  /** Writes whatever the store currently holds, so no call site has to
      remember the full argument list. */
  const flush = () => {
    const { mode, accent, coverCols, reduceMotion, statusColors } = get();
    apply(mode, accent, coverCols, reduceMotion, statusColors);
  };

  /** The palette's own writer. See `storedStatusColors` for why it is not
      `commit` — and the `try` because private-mode storage throws on write,
      where losing the preference is better than losing the colour change. */
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
    coverCols: storedCoverCols(),
    reduceMotion: localStorage.getItem(REDUCE_MOTION_KEY) === "true",
    statusColors: storedStatusColors(),

    setMode: (mode) => commit(MODE_KEY, "mode", mode),
    setAccent: (accent) => commit(ACCENT_KEY, "accent", accent),
    setCoverCols: (coverCols) =>
      commit(COVER_COLS_KEY, "coverCols", clampCols(coverCols)),
    setReduceMotion: (reduceMotion) =>
      commit(REDUCE_MOTION_KEY, "reduceMotion", reduceMotion),

    // Not through `commit`: that stringifies, and a palette needs JSON on both
    // sides. Per status rather than whole-palette because the picker drives one
    // swatch at a time and a caller holding a stale copy of the other five
    // would quietly undo them.
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
      // Track the OS theme while in "system" mode.
      window
        .matchMedia?.("(prefers-color-scheme: dark)")
        .addEventListener("change", () => {
          if (get().mode === "system") flush();
        });
    },
  };
});
