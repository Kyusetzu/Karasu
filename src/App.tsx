import { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { useAuth } from "@/stores/auth";
import { useNowPlaying } from "@/stores/nowPlaying";
import { useLibrary } from "@/stores/library";
import { useContentFilter } from "@/stores/contentFilter";
import {
  isTauri,
  checkForUpdates,
  downloadPendingUpdate,
  getTextScale,
  getUpdateCheckAuto,
} from "@/api/anilist";
import Titlebar from "@/components/Titlebar";
import Sidebar from "@/components/Sidebar";
import CommandPalette from "@/components/CommandPalette";
import ContextMenu from "@/components/ContextMenu";
import SignInMerge from "@/components/SignInMerge";
import Dashboard from "@/pages/Dashboard";
import MediaList from "@/pages/MediaList";
import Search from "@/pages/Search";
import Seasonal from "@/pages/Seasonal";
import Statistics from "@/pages/Statistics";
import AnimeDetail from "@/pages/AnimeDetail";
import Franchise from "@/pages/Franchise";
import Wrapped from "@/pages/Wrapped";
import LocalLibrary from "@/pages/LocalLibrary";
import Settings from "@/pages/Settings";
import About from "@/pages/About";

export default function App() {
  const init = useAuth((s) => s.init);
  const initNowPlaying = useNowPlaying((s) => s.init);
  const refreshLibrary = useLibrary((s) => s.refresh);
  const initContentFilter = useContentFilter((s) => s.init);
  useEffect(() => {
    init();
    initNowPlaying();
    refreshLibrary();
    initContentFilter();
  }, [init, initNowPlaying, refreshLibrary, initContentFilter]);

  // Karasu takes its size from Windows, not from the window width. Display
  // scaling arrives for free through WebView2; the Accessibility text-size
  // slider does not, so apply it here. 100% (the default) leaves the root at
  // the stylesheet's 16px and this is a no-op.
  useEffect(() => {
    if (!isTauri) return;
    getTextScale()
      .then((scale) => {
        if (scale !== 1) {
          document.documentElement.style.fontSize = `${16 * scale}px`;
        }
      })
      .catch(() => {});
  }, []);

  // At most once/day: check for an update and, if one is found, start
  // downloading it in the background. Installing still needs a separate,
  // explicit confirmation from the About page (see UpdateSection there).
  useEffect(() => {
    if (!isTauri) return;
    getUpdateCheckAuto().then((enabled) => {
      if (!enabled) return;
      checkForUpdates(false)
        .then((info) => {
          if (info.isNewer) downloadPendingUpdate().catch(() => {});
        })
        .catch(() => {});
    });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PresenceReporter />
      <CommandPalette />
      <ContextMenu />
      <SignInMerge />
      <PlaybackError />
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/list" element={<MediaList type="ANIME" />} />
            <Route path="/manga" element={<MediaList type="MANGA" />} />
            <Route path="/search" element={<Search />} />
            <Route path="/seasonal" element={<Seasonal />} />
            <Route path="/stats" element={<Statistics />} />
            <Route path="/wrapped" element={<Wrapped />} />
            <Route path="/library" element={<LocalLibrary />} />
            <Route path="/media/:id" element={<AnimeDetail />} />
            <Route path="/franchise/:id" element={<Franchise />} />
            {/* Alias for old links */}
            <Route path="/anime/:id" element={<AnimeDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/about" element={<About />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

/**
 * Playback failures ("no unwatched episode on disk", a moved file) used to be
 * swallowed at every call site. One banner reports them wherever they happen.
 */
function PlaybackError() {
  const error = useLibrary((s) => s.error);
  const clearError = useLibrary((s) => s.clearError);
  useEffect(() => {
    if (!error) return;
    const id = setTimeout(clearError, 6000);
    return () => clearTimeout(id);
  }, [error, clearError]);

  if (!error) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-surface-700 bg-surface-850 px-4 py-3 shadow-xl">
      <span className="text-sm text-ink-200">{error}</span>
      <button
        onClick={clearError}
        className="shrink-0 text-ink-500 hover:text-ink-200"
        aria-label="Dismiss"
      >
        <X className="size-3.75" />
      </button>
    </div>
  );
}

/** Friendly page name shown in the idle Discord presence. */
const PAGE_LABELS: Record<string, string> = {
  "/": "Overview",
  "/list": "Anime",
  "/manga": "Manga",
  "/search": "Search",
  "/seasonal": "Seasonal",
  "/stats": "Statistics",
  "/library": "Local library",
  "/settings": "Settings",
  "/about": "About",
};

/** Reports the current route to the backend for the Discord presence. */
function PresenceReporter() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!isTauri) return;
    const label =
      PAGE_LABELS[pathname] ??
      (pathname.startsWith("/media/") || pathname.startsWith("/anime/")
        ? "Details"
        : "Karasu");
    invoke("set_ui_page", { page: label }).catch(() => {});
  }, [pathname]);
  return null;
}
