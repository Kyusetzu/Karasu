import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { useNowPlaying } from "@/stores/nowPlaying";
import Titlebar from "@/components/Titlebar";
import Sidebar from "@/components/Sidebar";
import Dashboard from "@/pages/Dashboard";
import MediaList from "@/pages/MediaList";
import Search from "@/pages/Search";
import Seasonal from "@/pages/Seasonal";
import AnimeDetail from "@/pages/AnimeDetail";
import Settings from "@/pages/Settings";

export default function App() {
  const init = useAuth((s) => s.init);
  const initNowPlaying = useNowPlaying((s) => s.init);
  useEffect(() => {
    init();
    initNowPlaying();
  }, [init, initNowPlaying]);

  return (
    <div className="flex h-full flex-col">
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
            <Route path="/media/:id" element={<AnimeDetail />} />
            {/* Alias for old links */}
            <Route path="/anime/:id" element={<AnimeDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
