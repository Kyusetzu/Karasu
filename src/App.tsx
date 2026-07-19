import { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "@/stores/auth";
import { useNowPlaying } from "@/stores/nowPlaying";
import { useLibrary } from "@/stores/library";
import { isTauri } from "@/api/anilist";
import Titlebar from "@/components/Titlebar";
import Sidebar from "@/components/Sidebar";
import CommandPalette from "@/components/CommandPalette";
import SignInMerge from "@/components/SignInMerge";
import Dashboard from "@/pages/Dashboard";
import MediaList from "@/pages/MediaList";
import Search from "@/pages/Search";
import Seasonal from "@/pages/Seasonal";
import Statistics from "@/pages/Statistics";
import AnimeDetail from "@/pages/AnimeDetail";
import Settings from "@/pages/Settings";
import About from "@/pages/About";

export default function App() {
  const init = useAuth((s) => s.init);
  const initNowPlaying = useNowPlaying((s) => s.init);
  const refreshLibrary = useLibrary((s) => s.refresh);
  useEffect(() => {
    init();
    initNowPlaying();
    refreshLibrary();
  }, [init, initNowPlaying, refreshLibrary]);

  return (
    <div className="flex h-full flex-col">
      <PresenceReporter />
      <CommandPalette />
      <SignInMerge />
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
            <Route path="/media/:id" element={<AnimeDetail />} />
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

/** Friendly page name shown in the idle Discord presence. */
const PAGE_LABELS: Record<string, string> = {
  "/": "Overview",
  "/list": "Anime",
  "/manga": "Manga",
  "/search": "Search",
  "/seasonal": "Seasonal",
  "/stats": "Statistics",
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
