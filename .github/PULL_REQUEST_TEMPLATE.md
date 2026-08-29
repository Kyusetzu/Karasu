<!--
Thanks for this. CONTRIBUTING.md has the full picture; the checklist below is
the part that gets PRs sent back if it is missed.
-->

## What this changes

<!-- What was wrong or missing before, and what it does now. A sentence or two
     is plenty — the commit message is where the detail belongs. -->

Fixes #

## How it was checked

<!-- `npm run verify` is the gate, but say what you actually exercised beyond
     it: which screen, which detection source, which account format — and for
     UI changes, which shell you looked at (desktop window, phone shell, or
     both). Anything you could not test — a Linux-only path from Windows, a
     live Jellyfin server — say so plainly rather than leaving it implied. -->

## Checklist

- [ ] `node scripts/bump-version.mjs <patch|minor|major>` was run — all five
      version places move together
- [ ] `npm run verify` passes, run bare (not piped through anything)
- [ ] New logic that could live in `src/lib/` or a pure Rust fn does, with a
      test beside it
- [ ] Any new i18n key exists in **both** `en.ts` and `de.ts`
- [ ] Any new AniList field was validated against the live schema
- [ ] `scripts/android-check.ps1` was run if this touches Rust that compiles
      on Android (`cfg(mobile)` / `cfg(target_os = "android")`) — or the
      description says why that does not apply
- [ ] Commit message is prose and ends with a `Co-Authored-By:` trailer
- [ ] Nothing here is on CONTRIBUTING.md's rejected list

<!-- If this touches dependencies, tauri.conf.json, or anything in the bundle,
     also run `npm run tauri build` and read its warnings — `cargo test` cannot
     see a function that is dead in a release build. -->
