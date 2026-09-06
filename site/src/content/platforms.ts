import release from "@/generated/release.json";

export type Tier = "stable" | "experimental";

export interface Platform {
  id: string;
  name: string;
  tier: Tier;
  /** What the download is. */
  install: string;
  download: { label: string; href: string };
  secondary?: { label: string; href: string };
  works: string[];
  limits: string[];
}

/**
 * The criterion is printed on the page: Stable means in the current tagged
 * release and used daily by the maintainer; Experimental means in the
 * release and built by CI, but not daily-driven.
 */
export const TIERS: Record<Tier, { label: string }> = {
  stable: { label: "Stable" },
  experimental: { label: "Experimental" },
};

export const PLATFORMS: Platform[] = [
  {
    id: "windows",
    name: "Windows",
    tier: "stable",
    install: "An installer for 64-bit Windows. It is not code-signed, so SmartScreen may warn on first run; verify the download against the checksums if you like.",
    download: { label: "Download for Windows", href: release.assets.windows },
    secondary: { label: "SHA256SUMS.txt", href: release.assets.sums },
    works: [
      "Every detection source: media sessions, player and browser windows, mpv, Jellyfin",
      "Streaming and manga sites in the browser",
      "Tray icon, autostart, the built-in updater",
      "Portable mode: drop a karasu.portable file beside the exe",
    ],
    limits: [],
  },
  {
    id: "android",
    name: "Android",
    tier: "stable",
    install: "A sideloaded APK, Android 7 and up, signed with the project key so a newer one installs over the old. Take the arm64 build; universal is the fallback.",
    download: { label: "Download the APK (arm64)", href: release.assets.androidArm64 },
    secondary: { label: "Universal APK", href: release.assets.androidUniversal },
    works: [
      "The list, statistics, notifications, the social pages",
      "Four home-screen widgets, drawn from the cache with no network",
      "Background notification check with the app closed",
      "Share an anilist.co link into Karasu",
    ],
    limits: ["Detection is Jellyfin only", "No in-app updater: install the new APK over the old one"],
  },
  {
    id: "linux",
    name: "Linux",
    tier: "experimental",
    install: "An AppImage for x86_64. It needs webkit2gtk-4.1 on the system (Ubuntu 22.04+, Debian 12+, Arch); make it executable and run it.",
    download: { label: "Download the AppImage", href: release.assets.linux },
    secondary: { label: "SHA256SUMS.txt", href: release.assets.sums },
    works: [
      "Media sessions over MPRIS, mpv over its socket, Jellyfin",
      "Everything the list, statistics and social pages do",
      "The built-in updater, for a running AppImage",
    ],
    limits: [
      "No window-title detection (Wayland forbids it), so no manga detection",
      "A tray icon needs a StatusNotifier host; without one, closing the window quits",
    ],
  },
];
