import { Routes, Route } from "react-router-dom";
import Titlebar from "@/components/Titlebar";
import Sidebar from "@/components/Sidebar";
import Dashboard from "@/pages/Dashboard";
import AnimeList from "@/pages/AnimeList";
import Search from "@/pages/Search";
import Seasonal from "@/pages/Seasonal";
import AnimeDetail from "@/pages/AnimeDetail";
import Settings from "@/pages/Settings";

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/list" element={<AnimeList />} />
            <Route path="/search" element={<Search />} />
            <Route path="/seasonal" element={<Seasonal />} />
            <Route path="/anime/:id" element={<AnimeDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
