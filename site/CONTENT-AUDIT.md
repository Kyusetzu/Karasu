# Content audit

Every claim the site makes, and what in the repository makes it true. A
sentence with no row here does not go on the page; a row whose evidence
moves takes the sentence with it. Paths are relative to the repository root.

Status: **confirmed** (read in the code), **partial** (true with the stated
limit), **pending** (written, not yet audited).

| # | Claim on the page | Evidence | Status |
|---|---|---|---|
| 1 | "A modern anime & manga tracker, built exclusively for AniList." | `README.md:8`, `src-tauri/tauri.conf.json:37`, `CLAUDE.md` Project section | confirmed |
| 2 | "Karasu watches what you play and read and keeps your AniList progress in sync — no buttons to press." | `src-tauri/src/playback/detection/mod.rs:229-286` (four sources), `src-tauri/src/playback/scrobbler.rs` (the write), `README.md:24-31` | confirmed |
| 3 | "Free · open source" | `LICENSE` (MIT), repository public | confirmed |
| 4 | "Windows · Linux · Android" | `.github/workflows/release.yml` (NSIS, AppImage, two APKs), `README.md` Platforms | confirmed |
| 5 | "MIT licensed · © 2026 Kyu and Karasu contributors" | `LICENSE:3`, `src-tauri/tauri.conf.json:40` | confirmed |
| 6 | "Not affiliated with AniList." | No affiliation exists; the app uses the public API with a public client id (`src-tauri/src/commands/auth.rs:13`) | confirmed |
| 7 | Download links (version, four assets, checksums) | `src/generated/release.json`, refreshed from `releases/latest` by `scripts/release-info.mjs` | confirmed |
