# Roadmap

**The complete list of what stands between the tree and the next milestone —
and nothing else.** This file is maintained by deletion: an item that ships
is removed, not annotated, and history lives where history already lives
(commit subjects, and CHANGELOG.md's tag-time curation). Settled decisions
and their reasons are CLAUDE.md's job. If an item is neither open work nor a
decision the next milestone waits on, it does not belong here.

**This file is not `CHANGELOG.md`, on purpose.** `scripts/release/release-notes.ps1`
slices that file between `## <version>` and the next `## `, so a stray heading
there truncates a published release body. Open work goes here; shipped work
goes there, at tag time.

For what will *never* be built, see the "Explicitly rejected" section of
`CLAUDE.md` — activity and playback-history expansion, manga cost tracking,
settings cloud-sync, Plex and Emby, RSS/torrent release feeds, and anything
needing a hosted backend.

---

## After v1.0.0

v1.0.0 was tagged on 2026-09-05. The backlog, each item with its recorded
reason:

### Carried over from the release audit

The audit's own reports are gone (they were a list of unfixed weaknesses in a
repository about to be public, which is a finding it raised against itself).
Everything it found at P1 and P2 is fixed, as is every P3 with a behavioural
consequence. What is left is recorded here rather than in a deleted folder:

Everything still listed here is blocked on something no amount of work in the
repository supplies — a device, a live API, or a decision that is the
maintainer's. Each says which, so none of them reads as unstarted work.

**Found by the pre-tag sweep of 2026-09-05, deferred on purpose:**

- **The widgets' empty state is English on a German phone.** `Widgets.kt`
  falls back to a hard-coded "Open Karasu" / "Karasu" when `widgets.json` is
  absent — which is exactly what sign-out leaves behind. Read the two labels
  from `strings_widgets.xml` (both locales already exist) instead. Deferred
  because seeing it costs a sign-out, and the maintainer had just signed back
  in.
- **Dependabot #15 (rustls) and #16 (the npm group).** #15 touches the one
  path nothing on this machine can check — Android TLS through the named
  aws-lc-rs provider in `net.rs`; #16 moves the JS halves of two Tauri
  plugins while their Rust halves stay pinned. Both after a device pass
  re-verifies Android TLS and the deep link. #13 and #14 (the two actions)
  are proven by any rolling run and can go first. A Dependabot squash does
  not bump the version: `node scripts/bump-version.mjs patch --force` after
  each merge keeps `COMMIT_NUMBER` monotonic.

**Needs a user, or a decision already made:**

- **User-installed CAs on Android** — the webpki-roots trade documented in
  `net.rs`. Revisit only if a user with such a setup actually asks.
- **`MediaSessionManager` detection on Android** — moot while the app is
  sideloaded: the notification-listener permission is a Play policy
  question, and Play distribution is itself not planned (maintainer,
  August 2026; sideload is the model, `adb install -r` is the update path,
  and Android must never gain an updater by accident).
