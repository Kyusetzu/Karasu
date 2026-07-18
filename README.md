<p align="center">
  <img src="assets/logo.png" alt="Karasu" width="280" />
</p>

<h1 align="center">Karasu</h1>

<p align="center">
  A modern anime tracker for Windows — built exclusively for <a href="https://anilist.co">AniList</a>.<br/>
  Inspired by <a href="https://github.com/erengy/taiga">Taiga</a>, rebuilt from scratch with Tauri 2, React and Rust.
</p>

## Features

- **Automatic detection** — recognizes what you are watching in local players (mpv, VLC, MPC-HC/BE, PotPlayer, SMPlayer) and in the browser (Crunchyroll and more)
- **Scrobbling** — updates your AniList progress automatically after a configurable threshold, with optional confirmation, episode-gap protection and [anime-relations](https://github.com/erengy/anime-relations) episode redirects
- **List management** — status tabs, grid/list view, inline editing, search and sorting, with optimistic updates and an **offline queue** that syncs your changes once you are back online
- **Discovery** — search, seasonal charts, detail pages with relations, airing calendar
- **Discord Rich Presence** — show what you are watching
- **Quality of life** — dark UI, system tray, single instance, autostart, statistics, English/German with automatic system-language detection

## Installation

Download the latest `Karasu_x64-setup.exe` from the [releases page](../../releases) and run it.

On first start, open **Settings → Connect with AniList**, log in with your AniList account in the browser and paste the token — that's it.

## Development

Prerequisites: [Node.js](https://nodejs.org) ≥ 20, [Rust](https://rustup.rs) (MSVC toolchain), VS Build Tools with C++ workload, WebView2 (included in Windows 11).

```sh
npm install
npm run tauri dev    # development build with hot reload
npm run tauri build  # release build + NSIS installer
```

Run the Rust test suite (title parser, matcher, relations, detection profiles):

```sh
cargo test --manifest-path src-tauri/Cargo.toml
```

### Architecture

| Layer | Technology |
|---|---|
| Shell | Tauri 2 (Rust backend, WebView2) |
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| State | TanStack Query (server), Zustand (client), i18next (i18n) |
| Storage | SQLite via rusqlite (cache, offline queue, settings); tokens in the Windows Credential Manager |
| Detection | Win32 window enumeration + custom release-name parser (Anitomy equivalent) |

### Shared application IDs

Karasu ships with a built-in AniList client ID and Discord application ID (see
`BUILTIN_ANILIST_CLIENT_ID` in `src-tauri/src/commands.rs` and
`BUILTIN_DISCORD_APP_ID` in `src-tauri/src/discord/mod.rs`), so users don't
need to register anything themselves. Both can be overridden in the settings.

## License

[MIT](LICENSE)
