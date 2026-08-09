import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { reportError } from "@/api/diagnostics";
import { useTheme } from "@/stores/theme";
import "@/i18n";
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
      retry: 1,
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
