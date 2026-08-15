import { lazy, Suspense, useEffect } from "react";
import { Link, Routes, Route, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { useAuth } from "@/stores/auth";
import { usePlatform } from "@/stores/platform";
import { useNowPlaying } from "@/stores/nowPlaying";
import { useLibrary } from "@/stores/library";
import { useContentFilter } from "@/stores/contentFilter";
import { usePrimedLists } from "@/hooks/usePrimedLists";
import {
  isTauri,
  checkForUpdates,
  downloadPendingUpdate,
  getTextScale,
  getUpdateCheckAuto,
} from "@/api/anilist";
import Titlebar from "@/components/shell/Titlebar";
import Sidebar from "@/components/shell/Sidebar";
import Toast from "@/components/shell/Toast";
import CommandPalette from "@/components/shell/CommandPalette";
import KeyboardSheet from "@/components/shell/KeyboardSheet";
import GlobalKeys from "@/components/shell/GlobalKeys";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useViewTransitions } from "@/hooks/useViewTransitions";
import ContextMenu from "@/components/shell/ContextMenu";
import SignInMerge from "@/components/overlays/SignInMerge";
import Dashboard from "@/pages/Dashboard";
import MediaList from "@/pages/MediaList";
import Search from "@/pages/Search";
import Seasonal from "@/pages/Seasonal";
import AnimeDetail from "@/pages/AnimeDetail";

// Split out of the entry chunk. These are the pages you do not land on: they
// are reached deliberately, so a frame of nothing while the chunk loads is
// invisible. Dashboard, MediaList, Search, Seasonal and AnimeDetail stay eager
// — those are the launch and navigation hot path.
//
// Modest by itself: served over tauri:// there is no download, so this buys
// parse and evaluate time rather than transfer.
const Statistics = lazy(() => import("@/pages/Statistics"));
const Calendar = lazy(() => import("@/pages/Calendar"));
const Franchise = lazy(() => import("@/pages/Franchise"));
const Wrapped = lazy(() => import("@/pages/Wrapped"));
const LocalLibrary = lazy(() => import("@/pages/LocalLibrary"));
const Settings = lazy(() => import("@/pages/Settings"));
const About = lazy(() => import("@/pages/About"));
const UserProfile = lazy(() => import("@/pages/UserProfile"));
const Social = lazy(() => import("@/pages/Social"));
const Thread = lazy(() => import("@/pages/Thread"));
const Forum = lazy(() => import("@/pages/Forum"));
const CharacterPage = lazy(() =>
  import("@/pages/Person").then((m) => ({ default: m.CharacterPage })),
);
const StaffPage = lazy(() =>
  import("@/pages/Person").then((m) => ({ default: m.StaffPage })),
);
const StudioPage = lazy(() =>
  import("@/pages/Person").then((m) => ({ default: m.StudioPage })),
);

export default function App() {
  const { pathname } = useLocation();
  const init = useAuth((s) => s.init);
  const initNowPlaying = useNowPlaying((s) => s.init);
  const refreshLibrary = useLibrary((s) => s.refresh);
  const initContentFilter = useContentFilter((s) => s.init);
  // A primitive, so the selector is referentially stable across renders.
  const viewerId = useAuth((s) => s.viewer?.id);
  // Route changes become a continuous transition rather than a cut followed by
  // an arrival. Declines to intercept under reduced motion, in which case
  // `<main key={pathname}>` below behaves exactly as it always has.
  useViewTransitions();

  useEffect(() => {
    init();
    initNowPlaying();
    refreshLibrary();
    initContentFilter();
  }, [init, initNowPlaying, refreshLibrary, initContentFilter]);

  // Paint the list from SQLite as soon as the viewer is known, rather than
  // waiting out a full AniList round trip on every launch.
  usePrimedLists(viewerId);

  // Karasu takes its size from Windows, not from the window width. Display
  // scaling arrives for free through WebView2; the Accessibility text-size
  // slider does not, so apply it here. 100% (the default) leaves the root at
  // the stylesheet's 16px and this is a no-op.
  // Platform facts, read once — nothing here changes while the app is open.
  const loadPlatform = usePlatform((s) => s.load);
  useEffect(() => {
    loadPlatform();
  }, [loadPlatform]);

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
      <KeyboardSheet />
      <GlobalKeys />
      <ContextMenu />
      <SignInMerge />
      <PlaybackError />
      <Toast />
      <Titlebar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {/* Keyed on the route so the pane re-mounts and the animation replays.
            One direction only — down from above, like a bird landing. No
            slide-left/right, which would imply a history axis the app has
            not got. */}
        <main
          key={pathname}
          className="min-w-0 flex-1 animate-settle overflow-y-auto"
        >
          {/* Keyed on the route as well, so navigating away from a page that
              threw resets the boundary — otherwise the fallback would outlive
              the broken page and the app would look permanently crashed.
              Inside `<main>` on purpose: the titlebar, sidebar and toast stay
              alive, so the window is still closable and still navigable. */}
          <ErrorBoundary key={pathname}>
            <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/list" element={<MediaList type="ANIME" />} />
                <Route path="/manga" element={<MediaList type="MANGA" />} />
                <Route path="/search" element={<Search />} />
                <Route path="/seasonal" element={<Seasonal />} />
                <Route path="/calendar" element={<Calendar />} />
                <Route path="/stats" element={<Statistics />} />
                <Route path="/wrapped" element={<Wrapped />} />
                <Route path="/library" element={<LocalLibrary />} />
                <Route path="/media/:id" element={<AnimeDetail />} />
                <Route path="/franchise/:id" element={<Franchise />} />
                <Route path="/social" element={<Social />} />
                {/* By name, not id: that is what AniList's own URLs, an
                    `@mention` and a pasted link all carry. */}
                <Route path="/user/:name" element={<UserProfile />} />
                <Route path="/forum" element={<Forum />} />
                <Route path="/thread/:id" element={<Thread />} />
                <Route path="/character/:id" element={<CharacterPage />} />
                <Route path="/staff/:id" element={<StaffPage />} />
                <Route path="/studio/:id" element={<StudioPage />} />
                {/* Alias for old links */}
                <Route path="/anime/:id" element={<AnimeDetail />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/about" element={<About />} />
                {/* A hash that matches nothing rendered an empty `<main>` with
                    the frame still around it, which reads as the page having
                    crashed. Reachable in practice: the window restores the
                    last route, so a renamed one strands whoever was on it. */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

/** The route that matches nothing, so a stale one is a page rather than a void. */
function NotFound() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">{t("notFound.title")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-500">
          {t("notFound.body")}
        </p>
        <p className="mt-2 break-all text-xs text-ink-600">{pathname}</p>
        <Link
          to="/"
          className="mt-5 inline-block rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-accent-ink"
        >
          {t("notFound.home")}
        </Link>
      </div>
    </div>
  );
}

/**
 * Playback failures ("no unwatched episode on disk", a moved file) used to be
 * swallowed at every call site. One banner reports them wherever they happen.
 */
function PlaybackError() {
  const { t } = useTranslation();
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
      <span className="text-sm text-ink-300">{error}</span>
      <button
        onClick={clearError}
        className="shrink-0 text-ink-500 hover:text-ink-100"
        aria-label={t("common.dismiss")}
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
  "/calendar": "Calendar",
  "/social": "Social",
  "/forum": "Forum",
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
        : // Never the name — a presence broadcast to Discord should not say
          // whose profile is open.
          pathname.startsWith("/user/")
          ? "Profile"
          : pathname.startsWith("/thread/")
            ? "Forum"
            : "Karasu");
    invoke("set_ui_page", { page: label }).catch(() => {});
  }, [pathname]);
  return null;
}
