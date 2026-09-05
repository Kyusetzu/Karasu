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

## Milestone: v1.0.0

Feature work is done; the tag is cut on the maintainer's explicit word and
not before. What remains:

### The device pass

Done. Verified on hardware between 2026-08-30 and 2026-09-05: the four
widgets and their emptying on sign-out, HTTP/2 on both platforms, the share
target bare and buried, the deep link warm and cold, the offline detail page
and a queued +1 drained to AniList, the update notice clearing itself over
two real updates, Windows pause detection, the local library at its real
size, database recovery from a daily backup, the background job registering
once `ACCESS_NETWORK_STATE` was declared, running with the app dead,
surviving a reboot without the app being opened and posting a real system
notification from that run, the Android sign-in timed (the Keystore write is
27 ms; the viewer fetch is the cost), and the round-10 surfaces judged by the
maintainer.

### Cutting the release, mechanically

The CHANGELOG header documents the file's own half; the whole sequence, in
order:

1. `node scripts/changelog.mjs`, then rewrite `CHANGELOG.md`'s headings:
   rename `## Unreleased` to `## 1.0.0` (a trailing ` — 2026-…` date is fine;
   brackets or a fourth segment break the slicer's match and the tag build
   throws), open a fresh empty `## Unreleased` above it carrying a
   `<!-- generated-through: <sha> -->` marker, and delete the "there has been
   no tagged release yet" paragraph, which stops being true. The section's
   contents are generated, so this is heading surgery rather than a writing
   pass; read it once and reach for a `Changelog:` trailer on anything whose
   line reads badly.
2. `node scripts/bump-version.mjs major`, in the same dirty tree — the
   CHANGELOG edit is what lets the bump run without `--force`. It lands on
   `1.0.0.<commit#>` and prints it for the commit subject.
3. `npm run verify`, bare, never piped. Then the build smoke above if
   anything moved since it last ran.
4. One commit carrying the CHANGELOG rewrite and all five version files —
   the workflow reads both off the tagged commit.
5. `git tag -a v1.0.0` — annotated, because `git push --follow-tags`
   silently skips lightweight tags, and the only symptom would be a rolling
   rebuild and no release.
6. Push branch and tag — the maintainer's own action, every time. Two
   workflow runs start and cannot cancel each other (the concurrency group
   is keyed on the ref). The rolling `latest` prerelease survives as the
   prerelease channel and is rebuilt at the same content.
7. Watch the **precheck** job on the tag run: it is its own job with no
   dependencies, so the version-agreement check and the release-notes
   precheck really do fail in seconds. (They used to live inside
   `build-and-publish`, which waits on the two build jobs — measured at
   eleven minutes before it said a word.)
   Then confirm the published release — not marked prerelease, installer +
   AppImage (+ the two APKs if the secrets exist), `SHA256SUMS.txt`, and a
   `latest.json` whose version reads `1.0.0+<commit#>`. The `+` is
   load-bearing; CLAUDE.md's versioning section says why.

Two consequences worth knowing on tag day. v1.0.0 is the first
non-prerelease, so GitHub's `releases/latest` alias starts resolving and
the **Stable update channel goes live** the moment it publishes — its
manifest has 404'd since the channel existed. And once the release is
published the tag is immutable: a run that fails *after* the precheck can
be re-run against the same tag, but a broken tagged commit means
delete-tag, fix, re-tag — acceptable only while no release was published
under it.

## After v1.0.0

The backlog, each item with its recorded reason — none of it blocks the tag:

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
