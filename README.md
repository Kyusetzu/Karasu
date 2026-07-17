# Karasu 🐦‍⬛

Ein moderner Anime-Tracker für Windows — exklusiv für [AniList](https://anilist.co).

Karasu erkennt automatisch, welchen Anime du gerade schaust (Videoplayer oder Browser), und aktualisiert deinen AniList-Fortschritt. Inspiriert von [Taiga](https://github.com/erengy/taiga), neu gebaut mit Tauri 2, React und Rust.

## Features (geplant für v1)

- AniList-Login (OAuth), Listenverwaltung mit Offline-Queue
- Suche & Saison-Browser
- Automatische Erkennung laufender Player (mpv, VLC, MPC-HC, PotPlayer)
- Streaming-Erkennung im Browser (Crunchyroll u. a.)
- Auto-Update des Fortschritts (Scrobbling) mit Bestätigung
- Discord Rich Presence
- System-Tray, Single-Instance, dunkles Design

## Entwicklung

Voraussetzungen: Node.js, Rust (MSVC), VS Build Tools, WebView2.

```sh
npm install
npm run tauri dev
```

Release-Build: `npm run tauri build`
