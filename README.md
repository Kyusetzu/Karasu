<p align="center">
  <img src="assets/logo.png" alt="Karasu" width="280" />
</p>

<h1 align="center">Karasu</h1>

<p align="center">
  A modern anime &amp; manga tracker for Windows — built exclusively for <a href="https://anilist.co">AniList</a>.
</p>

<p align="center">
  <a href="https://github.com/Kyusetzu/Karasu/actions/workflows/ci.yml"><img src="https://github.com/Kyusetzu/Karasu/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white" alt="Windows" />
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
- **It tells you when something airs.** Native desktop notifications the moment a
  new episode of a show you follow is out.
- **It keeps stats the website doesn't have.** A local history of your real
  viewing turns into a weekday × hour heatmap, a 12-month calendar and watch
  streaks.
- **It shows up on Discord.** Rich Presence that reflects what you're doing,
  always on.

## Features

**Tracking**
- Automatic detection in local players (mpv, VLC, MPC-HC/BE, PotPlayer, SMPlayer)
  and in the browser (Crunchyroll and more)
- Manga reading detection (MangaDex, MANGA Plus, Comick, Bato, MangaFire, Asura Scans)
- Automatic scrobbling after a configurable threshold, with optional
  confirmation, episode-gap protection and
  [anime-relations](https://github.com/erengy/anime-relations) episode redirects

**Lists & discovery**
- Anime and manga lists with status tabs, grid/list views and an **offline queue**
  that syncs once you're back online
- Taiga-style quick editing: progress and score dropdowns, +1 and a one-click
  *Completed* action — plus full editing straight from search results
- Search with an anime/manga toggle, seasonal charts, detail pages, airing calendar

**Unique to the app**
- **Local library** with *play next episode* in your default player
- **New-episode desktop notifications** for the shows you're watching
- **Statistics tab** — AniList profile stats (genres, tags, voice actors, studios,
  staff) plus a Karasu-only **Activity** view built from your real playback history
- **Discord Rich Presence**, always on, with a link back to the project

**Quality of life**
- One-click AniList login, dark UI, system tray, single instance, autostart
- English / German with automatic system-language detection
- Built-in *Check for updates*

## Installation

Download the latest `Karasu_x64-setup.exe` from the
[releases page](https://github.com/Kyusetzu/Karasu/releases) and run it.

On first start, open **Settings → Log in with AniList** — your browser opens
AniList, you approve access, and Karasu logs you in automatically. (A manual
token paste is available as a fallback.)

## Development

Prerequisites: [Node.js](https://nodejs.org) ≥ 20, [Rust](https://rustup.rs)
(MSVC toolchain), VS Build Tools with the C++ workload, WebView2 (included in
Windows 11).

```sh
npm install
npm run tauri dev    # development build with hot reload
npm run tauri build  # release build + NSIS installer
```

Run the Rust test suite (title & chapter parser, matcher, relations, detection
profiles, login callback server, history, library):

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

### Architecture

| Layer | Technology |
|---|---|
| Shell | Tauri 2 (Rust backend, WebView2) |
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| State | TanStack Query (server), Zustand (client), i18next (i18n) |
| Storage | SQLite via rusqlite (cache, offline queue, history, settings); tokens in the Windows Credential Manager |
| Detection | Win32 window enumeration + custom release-name parser (Anitomy equivalent) |

### Shared application IDs

Karasu ships with a built-in AniList client ID and Discord application ID (see
`BUILTIN_ANILIST_CLIENT_ID` in `src-tauri/src/commands.rs` and
`BUILTIN_DISCORD_APP_ID` in `src-tauri/src/discord/mod.rs`), so users don't need
to register anything themselves. Both can be overridden in the settings. If you
use your own AniList API client, set its redirect URL to
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
