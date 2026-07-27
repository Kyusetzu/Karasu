import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { useTheme } from "./stores/theme";
import "./i18n";
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
