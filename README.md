<p align="center">
  <img src="assets/logo.png" alt="Karasu" width="280" />
</p>

<h1 align="center">Karasu</h1>

<p align="center">
  A modern anime &amp; manga tracker — built exclusively for <a href="https://anilist.co">AniList</a>.
</p>

<p align="center">
  <a href="https://github.com/Kyusetzu/Karasu/actions/workflows/ci.yml"><img src="https://github.com/Kyusetzu/Karasu/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white" alt="Windows" />
  <img src="https://img.shields.io/badge/Linux-experimental-FCC624?logo=linux&logoColor=black" alt="Linux (experimental)" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/github/v/release/Kyusetzu/Karasu?include_prereleases&label=release" alt="Release" />
</p>

---

## What is Karasu?

Karasu watches your list for you. Play an episode in your video player, read a
chapter in your browser, and Karasu recognizes it and updates your AniList
progress automatically — no buttons to press. It lives in your system tray,
speaks English and German, and is built as a small native app with Tauri, React
and Rust.

It is a modern successor to the wonderful — but no longer maintained —
[Taiga](https://github.com/erengy/taiga).

## Why use it over the website?

Because a desktop app can do things anilist.co simply can't:

- **It knows what you're actually watching.** Local players and browser tabs are
  detected and scrobbled for you.
- **It plays your files.** Point it at your anime folder and launch the next
  unwatched episode with one click, straight from your list.
- **It keeps you in the loop.** Desktop notifications and a bundled notification
  centre for new episodes, announced sequels, and titles you've left on hold.
- **It shows up on Discord.** Rich Presence that reflects what you're doing,
  always on.
- **It works without an account, too.** A fully local list on your device, with
  a one-time merge into AniList whenever you decide to connect.

## Features

**Tracking &amp; scrobbling**
- Automatic detection in local players (mpv, VLC, MPC-HC/BE, PotPlayer, SMPlayer)
  and in the browser (Crunchyroll and more)
- Manga reading detection (MangaDex, MANGA Plus, Comick, Bato, MangaFire, Asura Scans)
- Automatic scrobbling after a configurable threshold, with optional
  confirmation, episode-gap protection and
  [anime-relations](https://github.com/erengy/anime-relations) episode redirects

**Lists &amp; editing**
- Anime and manga lists with status tabs, grid/list views and an **offline queue**
  that syncs once you're back online
- Taiga-style quick editing (progress/score dropdowns, +1, one-click *Completed*)
  and a shared edit dialog straight from search results
- **Bulk multi-select** edits, saved **filter/sort presets**, a **random pick**,
  private **notes**, custom **tags** (with a tag filter), and a
  **rewatch/reread counter**

**Discovery**
- Search with an anime/manga toggle, seasonal charts, rich detail pages
- **Franchise graph** — the whole franchise as a relation map (sequels, side
  stories, cross-medium sources/adaptations), each node coloured by your status

**Insights**
- **Statistics** — AniList profile stats (genres, tags, voice actors, studios,
  staff) for both anime and manga
- **Year in review** — a shareable card of your year, exportable as a PNG
- Time-to-finish estimates and a Dashboard "this week" digest

**Notifications**
- New-episode desktop toasts, opt-in **sequel-announcement** alerts and
  **on-hold reminders**
- A bundled in-app **notification centre** (the bell in the title bar) with
  read / mark-all-read

**Integrations &amp; flexibility**
- **Local library** with *play next episode* in your default player
- **Discord Rich Presence**, always on, with a link back to the project
- **Local-only mode** (no account needed) with a later sign-in merge
- **Portable mode** — keep everything in a folder next to the executable

**Personalisation**
- Light / dark themes and a full **accent colour picker** (text stays readable
  on any colour)
- Command palette (<kbd>Ctrl</kbd>+<kbd>K</kbd>), an app-appropriate in-app
  right-click menu, system tray, single instance, autostart
- English / German with automatic system-language detection
- One-click AniList login and a built-in *Check for updates*

## Installation

Download the latest `Karasu_x64-setup.exe` from the
[releases page](https://github.com/Kyusetzu/Karasu/releases) and run it.

On first start, open **Settings → Log in with AniList** — your browser opens
AniList, you approve access, and Karasu logs you in automatically. (A manual
token paste is available as a fallback.) You can also pick **Use without an
account** to track locally and connect later.

> **Platforms.** Windows is the supported target. Linux (Ubuntu) support is
> experimental groundwork: the app compiles and its tests run on Linux in CI,
> but window detection and encrypted portable-token storage are not implemented
> there yet, and no Linux build is published.

## Development

Prerequisites: [Node.js](https://nodejs.org) ≥ 20, [Rust](https://rustup.rs)
(MSVC toolchain on Windows), VS Build Tools with the C++ workload, WebView2
(included in Windows 11). On Ubuntu, install `libwebkit2gtk-4.1-dev`,
`libgtk-3-dev`, `libayatana-appindicator3-dev` and `librsvg2-dev`.

```sh
npm install
npm run tauri dev    # development build with hot reload
npm run tauri build  # release build + installer (NSIS on Windows)

npm run typecheck    # TypeScript
npm test             # frontend unit tests (vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # backend tests
```

**Versioning.** Every commit bumps a four-part version
`MAJOR.MINOR.PATCH.COMMIT#` (breaking / feature / fix / commit counter); the
running version is shown in the About window.

### Architecture

| Layer | Technology |
|---|---|
| Shell | Tauri 2 (Rust backend, WebView2) |
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| State | TanStack Query (server), Zustand (client), i18next (i18n) |
| Storage | SQLite via rusqlite (cache, offline queue, local list, notifications, settings); tokens in the OS credential store (Windows Credential Manager, Secret Service on Linux) |
| Detection | Win32 window enumeration (Windows) + a custom release-name parser (Anitomy equivalent) |

### Shared application IDs

Karasu ships with a built-in AniList client ID and Discord application ID (see
`BUILTIN_ANILIST_CLIENT_ID` in `src-tauri/src/commands.rs` and
`BUILTIN_DISCORD_APP_ID` in `src-tauri/src/discord/mod.rs`), so users don't need
to register anything themselves. Discord uses the built-in application. If you
build with your own AniList API client, set its redirect URL to
`http://localhost:46231/callback` so the one-click login works.

## Contact

- Discord: **Kyusetzu**
- Email: **contact@kyusetzu.de**

## Star history

<a href="https://star-history.com/#Kyusetzu/Karasu&Date">
  <img src="https://api.star-history.com/svg?repos=Kyusetzu/Karasu&type=Date" alt="Star History Chart" width="600" />
</a>

## License

[MIT](LICENSE)
