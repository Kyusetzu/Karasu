import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { reportError } from "@/api/diagnostics";
import { isTokenRejected } from "@/api/anilist";
import { isNotFound } from "@/lib/apiError";
import { useTheme } from "@/stores/theme";
import { initLanguage } from "@/i18n";
// The @font-face rules live in index.css — see the note there for why the
// @fontsource stylesheets are not imported directly.
import "./index.css";

// Apply the saved theme before the first paint to avoid a flash.
useTheme.getState().init();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // AniList rate limit is tight — cache aggressively, no surprise refetches
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      // One retry, except where retrying cannot possibly help. A rejected
      // token answers the same way every time, so a bare `retry: 1` spent two
      // round-trips out of a ~30/min budget to reach the identical error — on
      // every query of every screen, since one dead token fails them all at
      // once. Same for a media id that does not exist.
      retry: (count, error) =>
        count < 1 && !isTokenRejected(error) && !isNotFound(error),
    },
  },
});

// Everything React's boundaries cannot see: a throw in an event handler, a
// rejected promise nobody awaited, a failed dynamic import. None of these
// unmount anything, so they leave no trace on screen either — which is exactly
// why they were the hardest failures to hear about.
window.addEventListener("error", (e) => {
  reportError(e.error ?? e.message, e.filename ? `${e.filename}:${e.lineno}` : undefined);
});
window.addEventListener("unhandledrejection", (e) => {
  reportError(e.reason);
});

// Awaited so a German start does not paint English first. English resolves in a
// microtask, so that path is unaffected — see `initLanguage`.
await initLanguage();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        {/* The last resort: a throw in the shell itself, where there is no
            frame left to keep. The one that does the real work wraps only the
            routed pane — see App. */}
        <ErrorBoundary standalone>
          <App />
        </ErrorBoundary>
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
