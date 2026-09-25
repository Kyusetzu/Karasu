import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "@/app/App";
import { useTheme } from "@/stores/theme";
import { useToast } from "@/stores/toast";
import { initLanguage, setLanguageSetting } from "@/i18n";
import { contrastRatio, mix } from "@/lib/contrast";

const html = document.documentElement;
const lang = new URLSearchParams(location.search).get("lang") ?? "de";
// The toast store, so a screen can show a receipt without performing the write behind it.
(window as unknown as { __toast: typeof useToast }).__toast = useToast;

useTheme.getState().init();

// A style override with high contrast gets its accent pushed to 7:1 here, since the app derives none for it yet.
if (html.dataset.dir && html.dataset.contrast === "more") {
  const css = getComputedStyle(html);
  const read = (name: string) => css.getPropertyValue(name).trim();
  const page = read("--color-surface-950");
  const ink = read("--color-accent-ink");
  const toward = html.dataset.theme === "light" ? "#000000" : "#ffffff";
  const away = contrastRatio(ink, "#000000") > contrastRatio(ink, "#ffffff") ? "#000000" : "#ffffff";
  let a400 = read("--color-accent-400");
  for (let i = 0; i < 30 && contrastRatio(a400, page) < 7; i++) a400 = mix(a400, toward, 0.1);
  let a500 = read("--color-accent-500");
  for (let i = 0; i < 30 && contrastRatio(a500, ink) < 7; i++) a500 = mix(a500, away, 0.08);
  html.style.setProperty("--color-accent-400", a400);
  html.style.setProperty("--color-accent-500", a500);
  html.style.setProperty("--color-accent-600", mix(a500, "#000000", 0.16));
}

await initLanguage();
await setLanguageSetting(lang === "en" ? "en" : "de");

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}>
    <HashRouter>
      <App />
    </HashRouter>
  </QueryClientProvider>,
);
