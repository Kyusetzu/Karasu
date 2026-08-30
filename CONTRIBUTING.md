# Contributing to Karasu

Karasu is an anime and manga tracker for AniList — desktop (Windows and
Linux) and Android — built with Tauri 2, Rust and React. It is developed with heavy AI assistance and every change is
reviewed and verified by a human maintainer before it lands.

Issues, ideas and pull requests are all welcome. Read the two short sections
below first — the commit loop is mandatory, and the rejected list will save you
building something that cannot be merged.

## Before you start

Open an issue for anything larger than a fix. Karasu has opinions about scope,
and the ones that have already been decided are written down in
[CLAUDE.md](CLAUDE.md) — which is written for AI coding agents but is the real
architecture document, so it is worth reading whoever you are.

**These will not be merged, whatever the implementation looks like:**

- Anything requiring a hosted backend. Karasu talks to AniList directly from the
  user's machine, and there is no server of ours by design.
- Embedding an AniList client *secret*. Login is the implicit OAuth grant; a
  built-in client **id** is fine.
- Exposing the access token to the WebView. It stays in Rust.
- RSS/torrent release feeds or anything piracy-adjacent. New releases already
  come from AniList's own airing data.
- Plex or Emby integration. The maintainer runs Jellyfin and does not use them;
  revisit only if real users ask.
- A watch-history screen, a local activity store, manga cost tracking, or
  settings cloud sync.
- Multi-tracker support (MAL, Kitsu). Out of scope by charter — Karasu is an
  AniList client.

Two hard limits shape almost everything else:

- **The AniList rate limit is about 30 requests a minute**, shared between the
  UI, the scrobbler and four background alert passes. Batch reads
  (`Page.media(id_in:)`, ≤50 ids), bound any traversal, and never fetch because
  the user scrolled — paging is a button here, deliberately.
- **i18n key parity is enforced by the type system.** `de` is typed
  `de: typeof en`, so every English key needs a German one or `tsc` fails.
  `src/lib/i18nKeys.test.ts` covers the other direction.

## The commit loop

Three commands, in this order, for **every** commit. Not by hand.

```bash
node scripts/bump-version.mjs patch
```

`patch` for fixes, `minor` for features, `major` for breaks. The script moves
the version in all five places at once — `package.json`,
`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `COMMIT_NUMBER` in
`src-tauri/src/commands/update.rs`, and `Cargo.lock` — and prints the resulting
four-part version. It refuses to run when the working tree holds nothing but
version files, because a bump with nothing to describe is a double-run.

```bash
npm run verify
```

Typecheck, then the frontend tests, then the Rust tests. This is the whole gate
and exactly what CI runs, so the two cannot drift. **Run it bare and read the
exit code** — piping it through `grep` reports *grep's* status and has let a
type error sail through.

```bash
git commit
```

Commit messages are prose, not a convention format. Say what changed and why it
was wrong before; the log here is meant to be read. End the message with:

```
Co-Authored-By: <your name> <your email>
```

One commit per feature. For anything touching dependencies,
`tauri.conf.json`, or the bundle, also run `npm run tauri build` as a smoke
check and read its warnings — `cargo test` compiles `#[cfg(test)]` code and so
cannot see a function that is dead in a release build. The Android
equivalents: `scripts/android-check.ps1` for anything touching `cfg`-gated
Rust, and a real `npx tauri android build` for anything touching
`src-tauri/gen/android/` or the plugin set.

## Where code goes

- `src/lib/` — pure logic, with its `*.test.ts` beside it. **Prefer extracting
  logic here over testing it through a component.** A regression in untestable
  in-component logic is invisible until it ships.
- `src/hooks/` — React glue.
- `src/components/ui/` — primitives that know nothing about Karasu.
  `shell/` is the frame, `media/` renders titles, `overlays/` opens over things.
- `src-tauri/src/commands/` — frontend-facing commands, grouped by subject.
- Platform-specific Rust is `#[cfg(...)]`-gated, and Windows, Linux and
  Android (`cfg(mobile)` / `cfg(target_os = "android")`) are all real
  implementations — no stubs. iOS is deliberately not among them: like macOS,
  it is left to fail at compile rather than compile code nobody has tested
  there. Keep the decisions out of the gated modules so their tests run
  everywhere.

Two test projects, and the **filename** picks one: everything runs in node, and
only `*.dom.test.tsx` boots jsdom. That is a name rather than an inference on
purpose — one file misfiled took the suite from 2.0 s to 14.1 s.

Database changes go through a new `MIGRATION_V*` guarded by PRAGMA
`user_version`, applied through `apply()` so the schema change and the version
bump land in one transaction, with a `mem_db()` test.

## Things that have cost real time

The full list is in CLAUDE.md's "Notes that have cost real time"; these are the
ones most likely to bite a first contribution.

- **Validate AniList fields live before wiring them.**
  `node scripts/anilist-query.mjs <CONST> '<variables-json>'` reads the query
  constant off disk, so it checks what the app actually ships. A *mutation*
  cannot be validated by running it — use schema introspection instead.
- **`pageInfo.total` is a capped sentinel** on most AniList collections, not a
  count. A "load 400 more" label built from it is a lie.
- **A missing i18n key renders as the key**, silently. i18next does not throw.
- **Linux-only Rust does not compile on Windows**, so a green local run proves
  nothing about it. Let CI's `linux-build` job be the check.
- **The same goes for the `cfg(mobile)` arm** — `npm run verify` cannot see it.
  `scripts/android-check.ps1` (a cargo check for `aarch64-linux-android` with
  the NDK toolchain exported) is the local gate for Android-only Rust.
- **A suite that finishes far faster than usual failed early.** The Rust tests
  take about half a second; 0.02 s means something bailed.

## Running it

Windows 11 or a Linux desktop, Node 22+, and a stable Rust toolchain. Linux also
needs the system packages listed in the README, which are the same ones
`.github/workflows/ci.yml` installs.

```bash
npm install
```

```bash
npm run tauri dev
```

**Isolate a dev run or it edits the real install's data.** Debug and release
share an identifier, so they share `%APPDATA%\dev.kyu.karasu` and the
single-instance mutex. Drop an empty `karasu.portable` file beside
`src-tauri/target/debug/karasu.exe` and everything goes to `target/debug/data/`
instead. It lives inside the ignored `target/`, so `cargo clean` deletes it —
recreate it before trusting a dev run.

Building the Android APK additionally needs JDK 17 (Temurin), the Android SDK
(platform 36) and NDK 27.1.12297006; then `npx tauri android build --apk`. One
trap worth knowing up front: the Gradle daemon caches SDK-package resolution,
so a package installed after a failed build stays "not installed" until
`gradlew --stop`.

## Reporting bugs

Use the issue templates. **About → Copy diagnostics** composes everything a
report needs; it redacts your home directory by default. If detection is
involved, turn on verbose logging first and attach `karasu.log` — but read it
before you do, because with verbose logging on it names what you have been
watching.

Security issues do not go in the tracker. See [SECURITY.md](SECURITY.md).

## Conduct

Be decent. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
