import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { accentShades } from "@/lib/contrast";
import { DEFAULT_STATUS_COLORS, STATUS_COLOR_ORDER, statusVar } from "@/lib/statusColors";
import { DEFAULT_ACCENT, type Density } from "@/stores/theme";
import { setLanguageSetting } from "@/i18n/index";

export interface KarasuThemeProps {
  /** Dark is the app's default; light swaps the surface and ink ramps. */
  theme?: "dark" | "light";
  /** Any hex; the shades, the panel washes and the readable ink are derived from it, as in the app. */
  accent?: string;
  /** How much the dense screens (calendar, local library, digests) spread out. */
  density?: Density;
  /** The interface language the components render their own strings in; English unless asked. */
  lang?: "en" | "de";
  children?: ReactNode;
}

/** Lets a nested theme claim the document, so the innermost one wins the way a card's own frame should. */
const Nesting = createContext<((delta: 1 | -1) => void) | null>(null);

/** The root every Karasu screen sits in: theme and density on the document, the accent ramp derived, the page surface. */
export function KarasuTheme({ theme = "dark", accent = DEFAULT_ACCENT, density = "compact", lang = "en", children }: KarasuThemeProps) {
  const claim = useContext(Nesting);
  const inner = useRef(0);
  const [, bump] = useState(0);
  // Stable, or the nested theme re-claims on every render; a re-render is only owed when an inner one leaves.
  const onNested = useCallback((delta: 1 | -1) => {
    inner.current += delta;
    if (delta < 0) bump((n) => n + 1);
  }, []);

  useLayoutEffect(() => {
    if (!claim) return;
    claim(1);
    return () => claim(-1);
  }, [claim]);

  useLayoutEffect(() => {
    void setLanguageSetting(lang);
  }, [lang]);

  useLayoutEffect(() => {
    if (inner.current > 0) return;
    const html = document.documentElement;
    html.dataset.theme = theme;
    html.dataset.density = density;
    const { a400, a500, a600, ink, rgb, w1, w2, hair } = accentShades(accent, { light: theme === "light" });
    const root = html.style;
    root.setProperty("--color-accent-400", a400);
    root.setProperty("--color-accent-500", a500);
    root.setProperty("--color-accent-600", a600);
    root.setProperty("--color-accent-ink", ink);
    root.setProperty("--accent-rgb", rgb);
    root.setProperty("--w1", w1);
    root.setProperty("--w2", w2);
    root.setProperty("--hair", hair);
    for (const status of STATUS_COLOR_ORDER) root.setProperty(statusVar(status), DEFAULT_STATUS_COLORS[status]);
  });

  return (
    <Nesting.Provider value={onNested}>
      <div
        className="bg-surface-950 text-ink-100"
        style={{ minHeight: "100%", fontFamily: "var(--font-sans)", WebkitFontSmoothing: "antialiased" }}
      >
        {children}
      </div>
    </Nesting.Provider>
  );
}
