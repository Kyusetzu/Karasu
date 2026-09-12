import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { reportError } from "@/api/diagnostics";
import { isTokenRejected, setIdentityChangedHandler } from "@/api/anilist";
import { isNotFound, isRateLimited } from "@/lib/apiError";
import { useTheme } from "@/stores/theme";
import { initLanguage } from "@/i18n";
// The @font-face rules are hand-written in index.css; the @fontsource stylesheets are deliberately not imported.
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
      // One retry, except where it cannot help: a rejected token, a missing id or a rate limit answers the same way again.
      retry: (count, error) =>
        count < 1 &&
        !isTokenRejected(error) &&
        !isNotFound(error) &&
        !isRateLimited(error),
    },
  },
});

// A `clear()` rather than an invalidation: an invalidated entry stays renderable, showing the previous account's data.
setIdentityChangedHandler(() => queryClient.clear());

// What React's boundaries cannot see — handler throws, unawaited rejections, failed imports — leaves no trace on screen.
window.addEventListener("error", (e) => {
  reportError(e.error ?? e.message, e.filename ? `${e.filename}:${e.lineno}` : undefined);
});
window.addEventListener("unhandledrejection", (e) => {
  reportError(e.reason);
});

// Awaited so a German start does not paint English first; English resolves in a microtask, so that path is unaffected.
await initLanguage();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        {/* The last resort, for a throw in the shell itself; the boundary in App wraps only the routed pane. */}
        <ErrorBoundary standalone>
          <App />
        </ErrorBoundary>
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
