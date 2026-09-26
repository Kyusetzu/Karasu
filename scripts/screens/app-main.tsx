import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "@/app/App";
import { MotionProvider } from "@/app/motion";
import { useTheme } from "@/stores/theme";
import { useToast } from "@/stores/toast";
import { initLanguage, setLanguageSetting } from "@/i18n";

const lang = new URLSearchParams(location.search).get("lang") ?? "de";
// The toast store, so a screen can show a receipt without performing the write behind it.
(window as unknown as { __toast: typeof useToast }).__toast = useToast;

useTheme.getState().init();

await initLanguage();
await setLanguageSetting(lang === "en" ? "en" : "de");

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}>
    <HashRouter>
      <MotionProvider>
        <App />
      </MotionProvider>
    </HashRouter>
  </QueryClientProvider>,
);
