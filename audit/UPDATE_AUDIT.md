# Update System and Release Pipeline Audit

## Scope

Audit of Karasu's update client and release pipeline at commit `3381dec`
(app version `0.190.0.498`), read-only: no file in the repository was modified,
nothing was built, and no update was installed.

Sources read in full: `src-tauri/src/commands/update.rs`,
`scripts/bump-version.mjs`, all five scripts in `scripts/release/`
(`rename-installer.ps1`, `rename-appimage.ps1`, `rename-apk.ps1`,
`release-notes.ps1`, `generate-update-manifest.ps1`),
`.github/workflows/release.yml`, `.github/workflows/ci.yml`,
`src-tauri/tauri.conf.json`, `src-tauri/gen/android/app/build.gradle.kts`,
`src-tauri/src/portable.rs`, `src-tauri/src/sync.rs`,
`src-tauri/capabilities/default.json`, `src/pages/About.tsx`, `src/app/App.tsx`,
`src/components/shell/Bell.tsx`, plus `src-tauri/src/db.rs` and
`src-tauri/src/alerts/notify.rs` where the update path touches them. The
vendored `tauri-plugin-updater-2.10.1` (`src/{lib,updater,commands}.rs`) was
read rather than assumed; citations marked `(plugin)` refer to that copy.

Every finding below was re-verified against the working tree during an
adversarial verification pass. The original audit's citations into
`.github/workflows/release.yml` were systematically ~80–115 lines low and two
script citations were off; the quoted content matched in every case, so the
line numbers in this report are the re-resolved ones, not the originals.

## Findings at a glance

| ID | Severity | Category | File:Line | One-line summary |
|---|---|---|---|---|
| B2-06 | P3 | MISSING TEST | package.json:12 | Nothing compares the four files carrying the semver core, and a mismatch produces a permanent reinstall loop |
| B2-15 | P3 | BUG | src-tauri/src/commands/update.rs:577-593 | The daily check re-downloads the whole ~100 MB installer for an update the user already declined |
| B2-05 | P3 | BUG | src-tauri/src/commands/update.rs:548-591 | The updater plugin's HTTP client has no timeout at all, so a stalled download hangs the About page forever |
| B2-02 | P3 | BUG | .github/workflows/release.yml:122-129 | A missing/absent AppImage entry degrades into every Linux user being shown a green "up to date" tick |
| B2-04 | P3 | BUG | src-tauri/src/commands/update.rs:593-607 | The desktop download posts a bell row and an OS toast with no dedupe, one per day per ignored update |
| B2-01 | P3 | DATA INTEGRITY RISK | .github/workflows/release.yml:167-210 | Nothing checks that the version being published is greater than the one already published on the channel |
| B2-16 | P3 | BUG | src-tauri/src/commands/update.rs:128-143 | The 24 h throttle has no lower bound, so a backwards clock jump disables automatic checks indefinitely |
| B2-14 | P4 | INVESTIGATION | src-tauri/src/commands/update.rs:533 | The updater never consults `is_portable()`; the outcome for a portable Windows install is unestablished |
| B2-03 | P4 | BUG | src-tauri/src/commands/update.rs:169 | The throttle stamp is written before the status code and the body are validated, so a 5xx burns the day |
| B2-10 | P4 | IMPROVEMENT | src-tauri/src/commands/update.rs:59-76 | A channel switch clears the stash and the throttle but leaves the announced-version marker and the bell row |
| B2-08 | P4 | BUG | scripts/release/release-notes.ps1:50-65 | The Linux paragraph is unconditional, so the notes describe an AppImage a degraded release does not carry |
| B2-09 | P4 | BUG | .github/workflows/release.yml:366-374 | The rolling `latest` tag is force-moved before the release is published, not after |
| B2-17 | P4 | BUG | src-tauri/gen/android/app/build.gradle.kts:34 | Android `versionCode`/`versionName` do not move on a commit-only bump, so two APKs are one version to the OS |
| B2-07 | P4 | BUG | scripts/bump-version.mjs:94-113 | `writeAll`'s rollback restores every file except the one that threw, and does not name it as damaged |
| B2-13 | P4 | CODE SMELL | scripts/release/generate-update-manifest.ps1:123 | `latest.json` is the one release file written with `Out-File -Encoding utf8`, which is BOM-emitting on PS 5.1 |
| B2-12 | P4 | CODE SMELL | scripts/release/rename-installer.ps1:53 | `-replace`'s replacement operand carries substitution syntax and is fed a tag-derived suffix |
| B2-11 | P4 | DOCUMENTATION ISSUE | src-tauri/src/commands/update.rs:275-298 | `can_install`'s doc comment is attached to `updater_available`, and a second comment describes behaviour no code has |

---

ID: B2-06
Severity: P3
Category: MISSING TEST

File: /home/user/Karasu/package.json
Line: 12 (`"verify"`)
Function: `npm run verify`

Problem:
Nothing in the gate compares the four files that carry the semver core
(`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.lock`). `bump-version.mjs`'s own header says so at lines 85-91:
"Nothing in `npm run verify` compares the five, so that mismatch commits
silently". The script's `plan`/`writeAll` design makes a *bump-time* mismatch
very unlikely, but it is not the only way to get one, and the consequence is
worse than the header describes.

Expected Behavior:
A cheap test asserting the four cores are equal, so a mismatch is a red run
rather than a release.

Actual Behavior:
`"verify": "npm run typecheck && npm test && cargo test --manifest-path
src-tauri/Cargo.toml"`. No test in the node or the Rust suite reads more than one
version file — a grep for `package.json` across `src/**/*.test.ts` returns
nothing, and the Rust side reads only `env!("CARGO_PKG_VERSION")`. The release
pipeline does not compare them either, and its two consumers genuinely diverge:
`rename-installer.ps1:49` and `generate-update-manifest.ps1:60` read the version
from **`package.json`**, while the compiled binary reports
`env!("CARGO_PKG_VERSION")` from **`Cargo.toml`** (update.rs:18).

Reproduction (the mismatch is the precondition; the loop is the consequence):
1. `package.json` says `0.191.0`, `Cargo.toml` still says `0.190.0`,
   `COMMIT_NUMBER` is `499`. Reachable by a hand edit, a partial revert, a merge
   that took one side of a conflict, or `writeAll`'s rollback failing to restore
   the file that threw (B2-07).
2. The build produces a binary that reports `0.190.0.499`.
3. `generate-update-manifest.ps1` emits `version: "0.191.0+499"`.
4. A running client evaluates `remote_is_newer((0,191,0,499), (0,190,0))` →
   `(0,191,0,499) > (0,190,0,499)` → **true**.
5. It downloads and installs — and comes back reporting `0.190.0.499` again.
6. The next check offers the same "update" again, indefinitely.

Impact:
An update loop: the app downloads ~100 MB and reinstalls itself on every check,
forever, for every user on the channel. This is the exact failure mode
`version_parts` and the explicit `version_comparator` were introduced to
eliminate, arrived at from a different direction. More mundanely, the four-part
version in the About window and in `latest.json` disagree, so bug reports name a
build that does not exist.

Root Cause:
Version consistency is enforced only by the single script that writes the files,
and only at the moment it writes them. Nothing verifies the invariant
afterwards, and the two consumers of the version — the compiler and the
PowerShell scripts — read different files.

Recommended Fix:
Add `src/lib/version.test.ts` (node project) that reads all four files, extracts
the core with the same regexes `bump-version.mjs` uses, and asserts equality —
plus an assertion that `COMMIT_NUMBER` parses as a `u32`. It costs milliseconds
and runs in CI, in both release jobs, and locally.

Regression Tests Required:
The test described above is itself the requirement.

Confidence: HIGH

---

ID: B2-15
Severity: P3
Category: BUG

File: /home/user/Karasu/src-tauri/src/commands/update.rs
Line: 577-593
Function: `download_pending_update`

Problem:
`download_pending_update` never consults the existing stash before running
`updater.check()` (update.rs:577) and `update.download(...)` (update.rs:588-591).
The only read of `pending.0` in the whole path is the *write* at update.rs:593,
which replaces whatever was there. So a process that has already downloaded a
version downloads it again on the next non-throttled check.

Expected Behavior:
If the stash already holds the version the manifest advertises, the download and
the announcement should both be skipped. The download must still run when the
stash is empty — that is the fresh-process case the stash cannot cover, since it
is in-memory by design.

Actual Behavior:
```rust
let Some(update) = updater.check().await.map_err(|e| e.to_string())? else { ... };   // 577
let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;     // 588
*pending.0.guard() = Some((update, bytes));                                          // 593
```
`App.tsx:139-148` calls `checkForUpdates(false)` on every launch and then
`downloadPendingUpdate()` whenever `info.isNewer`. Karasu is a tray-resident app
with autostart, so the process routinely outlives the 24 h throttle window
(`UPDATE_CHECK_THROTTLE_MS`, update.rs:106): the check fires again inside the
same process, `is_newer` is still true because the user has not installed, and
the whole installer is fetched a second time and written over bytes the process
is already holding.

Reproduction:
1. Release `0.191.0+500` while the user runs `0.190.0.498`.
2. Leave Karasu running in the tray and never press "Restart to install".
3. Day 1: check → download (~100 MB) → stash + bell row.
4. Day 2, same process, throttle expired: check → download again (~100 MB) →
   stash replaced with equivalent bytes + a second bell row (B2-04).
5. Repeat once per day for as long as the update is declined.

Impact:
~100 MB of download per day, per user, for an update they have already seen and
declined — on a metered or capped connection that is a real cost, and it is
spent with nobody asking. During the transfer the process holds the old stash
and the new partial buffer at once, so peak memory is roughly double the
installer. B2-04 addresses the bell row that rides along with this but
explicitly keeps the download outside its proposed guard ("The stash write must
stay outside the guard"), so the bandwidth and memory half is not covered by
that fix.

Root Cause:
The stash is treated purely as an output of this function. It was introduced so
`pending_update` could tell the About page a download already exists
(update.rs:611-618 documents exactly that), and the same knowledge was never fed
back into the decision to download.

Recommended Fix:
After `updater.check()` resolves and before `download`, compare
`update.version` against the version already in the stash (`pending.0.guard()`,
via the `LockExt` helper the file already uses) and return the existing
`DownloadedUpdate` unchanged when they match — skipping both the download and
the notify. Keep the download for an empty stash. This subsumes B2-04's guard on
the same path, and the two should be fixed together.

Regression Tests Required:
Extract the decision as a pure helper — `fn needs_download(stashed:
Option<&str>, advertised: &str) -> bool` — and assert: empty stash → download;
stash holding the advertised version → skip; stash holding an older version →
download. The I/O around it stays untestable without a fixture, which is why the
decision has to leave the command.

Confidence: HIGH
Source: found during adversarial verification

---

ID: B2-05
Severity: P3
Category: BUG

File: /home/user/Karasu/src-tauri/src/commands/update.rs
Line: 548-591
Function: `download_pending_update`

Problem:
The updater plugin's HTTP client is built with no timeout, so both the manifest
check it performs and the ~100 MB installer download can hang forever. The
hand-rolled check in the same file explicitly sets 30 s and documents why; the
plugin-driven path was not given the same treatment.

Expected Behavior:
Every outbound client in this codebase has a timeout — `check_for_updates` says
so at update.rs:151-154: "A timeout, like every other outbound client in this
codebase. Without one this inherits `reqwest`'s default of *none*, so a
connection that opens and then stalls parks the About page's spinner until the
OS gives up".

Actual Behavior:
```rust
let updater = app.updater_builder()
    .endpoints(vec![endpoint])?      // no .timeout(...)
    .version_comparator(...)
    .build()?;
```
`UpdaterBuilder::new` sets `timeout: None` (plugin updater.rs:176); `check`
applies a timeout only `if let Some(timeout) = self.timeout` (plugin
updater.rs:458-460); `Update::download` does the same (plugin updater.rs:670-672)
and then streams chunks with no deadline at all (plugin updater.rs:704-710).
reqwest's default is no timeout.

Reproduction:
Start a download and have the connection stall after the headers — a captive
portal, a proxy that opens the socket and never sends the body, a flaky mobile
hotspot. `update.download(...)` never returns.

Impact:
- About: `About.tsx:254` sets `downloading` true and only clears it in `finally`
  (`:262`), so the spinner never resolves and the check button stays
  `disabled={busy || downloading || !isTauri}` (`:302`). The only way out is
  restarting the app.
- Startup path (`App.tsx:146`): the Tauri command task and its partially filled
  `Vec<u8>` (up to ~100 MB) are held for the life of the process, with nothing
  on screen.

Root Cause:
The timeout fix was applied to the one client this file constructs itself and
not to the one it constructs through the plugin builder.

Recommended Fix:
Do **not** use `UpdaterBuilder::timeout` for the download: it maps to reqwest's
*total request* timeout, which would abort legitimate slow downloads of a
~100 MB installer. Use the builder's `configure_client` hook to set
`connect_timeout` and `read_timeout`, which bound a stall without bounding total
transfer time. A plain `.timeout(Duration::from_secs(30))` is appropriate only if
the check is ever split from the download into a separate builder.

Regression Tests Required:
Not unit-testable without a local HTTP fixture. The minimum honest guard is a
comment at the builder naming which timeout kind is required and why the
total-request one is wrong, so a later "tidy" cannot swap them.

Confidence: HIGH

---

ID: B2-02
Severity: P3
Category: BUG

File: /home/user/Karasu/.github/workflows/release.yml
Line: 122-129 (`Upload AppImage`); /home/user/Karasu/scripts/release/generate-update-manifest.ps1:94-112;
/home/user/Karasu/src-tauri/src/commands/update.rs:215-227
Function: `build-linux` → `generate-update-manifest.ps1` → `check_for_updates`

Problem:
When the release publishes without a `linux-x86_64` entry in `latest.json`, the
Linux client reports a green tick and "You're on the latest version" while a
newer release exists. The manifest going out Windows-only when the Linux leg
fails is a documented deliberate decision (update.rs:201-205, and the
soft-dependency comments at release.yml:136-151 and
generate-update-manifest.ps1:83-89); the client rendering *success* rather than a
disclosure is not.

The chain, stage by stage:

1. `release.yml:122-129` uploads two globs under one `if-no-files-found: error`:

```yaml
path: |
  src-tauri/target/release/bundle/appimage/*.AppImage
  src-tauri/target/release/bundle/appimage/*.AppImage.sig
if-no-files-found: error
```

`actions/upload-artifact` builds one globber over all patterns and tests the
*combined* result set, so the `.AppImage` alone satisfies it and a missing `.sig`
does not fail the job. (This is a claim about a third-party action that cannot
be verified from this tree, which is what lowers the confidence below.)

2. `generate-update-manifest.ps1:94-112` finds the AppImage, does not find
`"$($appimage.FullName).sig"`, emits `Write-Host "::warning::..."` (`:111`) and
omits the `linux-x86_64` key. The release publishes normally. The far more
likely route to the same place is `build-linux` failing outright, so
`linux-artifacts/` is empty and the `if ($appimage)` at `:94` never runs at all.

3. `update.rs:215-227`:

```rust
let platform_key = if cfg!(target_os = "linux") { "linux-x86_64" } else { "windows-x86_64" };
let has_platform = body.pointer("/platforms").and_then(|p| p.get(platform_key)).is_some();
has_platform && version_gt(&latest, &current)
```

`is_newer` is `false`, `channel_empty` is `false`.

4. `src/pages/About.tsx:325-343` therefore renders the last branch:
`CheckCircle2` plus `t("about.upToDate")` in `text-success` —
`en.ts`: `upToDate: "You're on the latest version ({{version}})."`

Expected Behavior:
Either the Linux leg fails loudly (costing the AppImage, never the Windows
release — which is exactly what the soft dependency is for), or the client says
something true. "This release does not cover your platform" is the honest
answer; `channel_empty` already exists as the precedent for adding such a state,
and `UpdateInfo`'s own doc comment (update.rs:39-46) records that a green tick
over an unanswerable channel is considered a lie worth fixing.

Actual Behavior:
A green workflow, a release page whose notes still describe an AppImage
(B2-08), and every AppImage user told in green with a tick that they are current
until the next release whose Linux leg succeeds.

Reproduction:
Any run in which `latest.json` ends up without `linux-x86_64`:
- `build-linux` fails (a Linux-only compile error, an apt hiccup, a runner
  timeout) — the job is a soft dependency, so the publish continues;
- `createUpdaterArtifacts` is set to `"v1Compatible"`, which emits an
  `.AppImage.tar.gz` + `.tar.gz.sig` pair instead of `<name>.AppImage.sig`.
  `rename-appimage.ps1:63-66` explicitly anticipates that shape ("a prefix match
  catches `.sig` and a `.tar.gz` pair alike"), while
  `generate-update-manifest.ps1:95` only ever looks for
  `"$($appimage.FullName).sig"`.
The narrow trigger of a dropped `.sig` on an otherwise-successful build is
contrived: the job passes `TAURI_SIGNING_PRIVATE_KEY` with
`--config createUpdaterArtifacts:true` (release.yml:80-85) and Tauri fails the
bundle when a pubkey is configured and no private key is present.

Impact:
Loss of automatic updates for the Linux user base for one or more release
cycles, visible only as one `::warning::` annotation on a green run. Users are
actively misinformed rather than merely uninformed. The AppImage does remain
downloadable from the release page, so this is not a total dead end.

Root Cause:
The warning-instead-of-`throw` decision documented at
`generate-update-manifest.ps1:102-110` is about *the Windows publish job*, and it
is correct there — throwing under `$ErrorActionPreference = "Stop"` in that job
skipped checksums, `latest.json` and the installer upload. But no equivalent
check was added where it *is* safe to fail (`build-linux`, a soft dependency),
and the client-side platform gate at update.rs:215-227 was given no way to
distinguish "nothing newer" from "newer, but not for you".

Recommended Fix:
Two independent halves, both cheap:
1. In `build-linux`, after the rename, assert the `.sig` exists and fail the job
   if not. Failing `build-linux` is already survivable by design.
2. Give `UpdateInfo` a third boolean (e.g. `platformMissing`) set when
   `version_gt(&latest, &current)` is true but `has_platform` is false, and
   render it in `About.tsx` with the same warning treatment `channelEmpty` gets.
   This is the same fix, for the same reason, as the one recorded in
   `UpdateInfo`'s doc comment at update.rs:39-46.

Regression Tests Required:
- A Rust unit test over the platform gate: extract it into a pure
  `fn update_state(latest, current, has_platform) -> (bool /*is_newer*/, bool
  /*platform_missing*/)` and assert all four combinations.
- A `.dom.test.tsx` on the About update card asserting that `platformMissing`
  renders the warning branch and never `about.upToDate`.

Confidence: MEDIUM
Verification: downgraded from P2 — the manifest going out Windows-only is a
documented deliberate decision; only the client's green tick is the defect, the
state lasts until the next successful Linux leg rather than indefinitely, and
the AppImage stays downloadable. Confidence lowered from HIGH because step 1
rests on `actions/upload-artifact`'s combined-glob behaviour, which is not
verifiable from this tree.

---

ID: B2-04
Severity: P3
Category: BUG

File: /home/user/Karasu/src-tauri/src/commands/update.rs
Line: 593-607
Function: `download_pending_update`

Problem:
The desktop download path posts a bell row unconditionally on every successful
download. The Android check path has a de-duplication guard for exactly this;
the desktop path does not, although it writes the same kv.

Expected Behavior:
One "update ready" row per announced version, matching the Android arm.

Actual Behavior:
Android (update.rs:234-246):
```rust
if !force && is_newer && db.kv_get("last_notified_update_version").as_deref() != Some(&latest) {
    let _ = db.kv_set("last_notified_update_version", &latest);
    ... notify(...)
}
```
Desktop (update.rs:593-607):
```rust
*pending.0.guard() = Some((update, bytes));
let _ = db.kv_set("last_notified_update_version", &raw_version);
crate::alerts::notify::notify(&app, "update", ...);   // no guard at all
```
`Db::notif_insert` (db.rs:1083-1097) is a plain `INSERT` with no de-duplication
(it trims to `NOTIF_KEEP`, so growth is bounded, but nothing collapses
duplicates), and `clear_stale_update_notice` (update.rs:320-329) returns early
while the announced version is still above the running one, so the previous row
survives every restart. `alerts/notify.rs:44-56` also fires a native OS toast
each time.

Reproduction:
1. Release `0.191.0+500` while the user runs `0.190.0.498`; the user never
   installs it.
2. Day 1: throttle expired → `check_for_updates(false)` → `is_newer` →
   `App.tsx:146` calls `downloadPendingUpdate()` → one bell row, one OS toast.
3. Day 2, whether the process restarted or not, the throttle has expired, the
   check runs again, the download runs again (B2-15) — and a *second* identical
   row is inserted while the first is still there.
4. Seven days of ignoring the update → seven identical rows and seven toasts.

Impact:
The bell fills with duplicates of one notice, which is precisely what the bell's
grouping logic (`lib/notifGroups`) cannot collapse — it groups by actor or by
media, and an update row has neither. Corrosive rather than dangerous: the bell
is the surface the airing and sequel passes rely on being readable, and a daily
native toast for an already-declined update is a nuisance the user cannot turn
off short of disabling update checks.

Root Cause:
`last_notified_update_version` is written on the desktop path solely so
`clear_stale_update_notice` can compare it at startup; nothing reads it before
notifying.

Recommended Fix:
Wrap the notify in the same guard the Android arm uses —
`if db.kv_get("last_notified_update_version").as_deref() != Some(&raw_version)`
— and keep the `kv_set` inside it. Fix this together with B2-15: with the stash
consulted first, the guard and the skipped download become one decision, and the
download still runs for a fresh process with an empty stash so the About
"Restart to install" button still appears.

Regression Tests Required:
Extract the decision (`fn should_announce(previously_notified: Option<&str>,
version: &str) -> bool`) and assert: first announcement yes, repeat of the same
version no, a newer version yes.

Confidence: HIGH

---

ID: B2-01
Severity: P3
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/.github/workflows/release.yml
Line: 167-210 (`Resolve release target`), 404-447 (`Prune stale release assets`)
Function: the `build-and-publish` job, together with
`scripts/release/generate-update-manifest.ps1` and
`src-tauri/src/commands/update.rs:480` (`remote_is_newer`)

Problem:
Nothing in the pipeline checks that the version about to be published is
strictly greater than the version already published on the same channel. The
only version check that exists compares the *tag* against `package.json`
(release.yml:179-181):

```
$tagCore = ($core -split "-")[0]
if ($tagCore -ne $pkg) { throw "Tag $tag says $tagCore but package.json says $pkg ..." }
```

That runs only on a `refs/tags/*` push, and it covers the `MAJOR.MINOR.PATCH`
core only. The rolling `main` arm takes the `else` branch at release.yml:203 with
no version check whatsoever. `COMMIT_NUMBER` — the fourth segment, the one that
makes a commit-only release detectable — is never compared against anything.
`generate-update-manifest.ps1:55-68` reads `COMMIT_NUMBER` and `package.json` off
local disk and emits `"$packageVersion+$commitNumber"` without ever consulting
the currently published `latest.json`.

Expected Behavior:
Publishing to a channel should be refused (or at minimum reported) when the
resulting four-part version is not strictly greater than the version currently
advertised on that channel, because the whole update mechanism is a strict `>`
comparison and an equal or lower version is unreachable by every installed
client.

Actual Behavior:
A push to `main` whose commit did not bump `COMMIT_NUMBER` republishes a manifest
with the *same* `version` string and re-uploads an installer with the *same*
filename. `rename-installer.ps1:50-53` derives the name purely from
`package.json` + `COMMIT_NUMBER`, so the asset name collides with the one already
on the rolling release and `softprops/action-gh-release` replaces it. The prune
step then keeps it (it is in `$keep`, release.yml:418), so the release ends up
with one asset name mapping to freshly built bytes, a freshly generated `.sig`
inside `latest.json`, and a rewritten `SHA256SUMS.txt`.

No installed client is ever offered the new build: `remote_is_newer`
(update.rs:480-483) is a strict `>` on a 4-tuple, and `version_gt`
(update.rs:301-311) returns `false` on equality — both pinned by
`remote_is_newer_uses_the_running_commit_number` (update.rs:421-433).

Reproduction:
Reproducible from the tree as it stands:

```
$ grep -n "COMMIT_NUMBER: u32" src-tauri/src/commands/update.rs
13:pub const COMMIT_NUMBER: u32 = 498;
$ git show HEAD~1:src-tauri/src/commands/update.rs | grep "COMMIT_NUMBER: u32"
pub const COMMIT_NUMBER: u32 = 498;
```

HEAD (`3381dec`) carries `COMMIT_NUMBER = 498`, identical to its parent
(`94e12cf`); the commit message says so ("No code is touched by the audit, so no
version bump accompanies it"). Pushing HEAD to `main` runs `build-and-publish`,
which emits `latest.json` with `version: "0.190.0+498"` and uploads
`Karasu_0.190.0.498_x64-setup.exe` — both already on the `latest` release from
`94e12cf`.

Impact:
For a docs-only commit the practical harm is nil. The harm case is a *code*
commit landing without a bump — an `--amend` that dropped the version files, a
`git revert` of a bump, a squash-merge whose conflict resolution took the older
`update.rs`, or a hand edit `bump-version.mjs` never saw. Then the fix ships to
nobody: every already-updated client answers "you are on the latest version"
forever, with no error anywhere, and it stays that way until the next bumped
commit. Two materially different binaries are also published under one four-part
identity, so a bug report citing `0.190.0.498` no longer identifies a build.

Root Cause:
The four-part scheme's monotonicity is enforced only by `bump-version.mjs`, i.e.
by convention at author time. The publisher — the last place that could catch a
violation, and the only one that can see what is already public — performs no
version comparison at all.

Recommended Fix:
In `Resolve release target`, fetch the channel's current manifest (`gh release
view latest --json assets` → download `latest.json`, or a plain `curl` of the
manifest URL) and `throw` unless the version about to be published is strictly
greater, using the same `+`/`.`-agnostic comparison `version_parts` uses. Skip
the check when no manifest exists yet. **The check must live in the `else` arm at
release.yml:203 as well as beside the tag check** — the rolling arm publishes
`version=` empty and performs no validation of any kind today, and it is the arm
this defect actually fires on.

Regression Tests Required:
- The Rust tests asserting `!version_gt(v, v)` and `!remote_is_newer(same,
  running)` already exist and should be cited by the new workflow step, not
  duplicated.
- A script-level test (node or pwsh) for the new comparison: `0.190.0+498` vs
  `0.190.0+498` → refuse; `0.190.0+499` → allow; `0.189.9+999` → refuse.

Confidence: HIGH
Verification: downgraded from P2 — the trigger is a violation of a convention
CLAUDE.md states as mandatory and `bump-version.mjs` exists to enforce, so it is
a process slip rather than a defect that fires on its own; no user data is
corrupted, nothing installed breaks, and the state heals on the next bumped
commit. The "rewritten SHA256SUMS looks like tampering" argument is weak on a
rolling prerelease tag whose assets are rebuilt on every push.

---

ID: B2-16
Severity: P3
Category: BUG

File: /home/user/Karasu/src-tauri/src/commands/update.rs
Line: 128-143
Function: `check_for_updates`

Problem:
The throttle comparison has no lower bound. It is a one-sided
`now_ms() - last < UPDATE_CHECK_THROTTLE_MS` (update.rs:133), so a stamp written
while the machine's clock was wrong-and-ahead satisfies the condition for as
long as it takes real time to pass that stamp.

Expected Behavior:
A stamp in the future is not evidence that a check happened recently; it is
evidence the clock moved. The throttle should treat `now < last` as a reset and
check.

Actual Behavior:
```rust
if let Some(last) = last_check {
    if now_ms() - last < UPDATE_CHECK_THROTTLE_MS {
        return Ok(UpdateInfo { current, latest: None, url: None,
                               is_newer: false, channel_empty: false });
    }
}
```
`now_ms() - last` is negative whenever `last` is in the future, and a negative
value is always `< UPDATE_CHECK_THROTTLE_MS`, so the early `Ok` is taken on every
launch. The `UpdateInfo` returned is the "nothing to report" shape, so the
About page and the startup path both see a normal, successful, silent check.

Reproduction:
1. The clock is wrong-and-ahead — a dead CMOS battery reading 2031, a VM
   restored from a snapshot taken with a skewed clock, a manual clock change.
2. Karasu launches; the automatic check runs and stamps
   `last_update_check_ms` with the bad time.
3. NTP (or the user) corrects the clock back to real time.
4. Every subsequent launch takes the early return at update.rs:134-140 and never
   touches the network. Automatic update checks are off until real time passes
   the bad stamp — potentially years.

Impact:
Automatic update checks silently disabled for an unbounded period, with no
error, no log line and nothing on screen. The manual About check passes
`force: true` (About.tsx:270) and is unaffected, so the user has a way out — but
only if they think to look. Same family as B2-03 and strictly more durable: B2-03
costs one day, this costs however far the clock jumped.

Root Cause:
The throttle was written as a one-sided elapsed-time test, which is correct only
under a monotonic clock. `now_ms()` is wall time.

Recommended Fix:
One line: treat a future stamp as no stamp.
```rust
let elapsed = now_ms() - last;
if (0..UPDATE_CHECK_THROTTLE_MS).contains(&elapsed) { return Ok(...); }
```
The same shape applies to `background.rs:104`, which has the identical one-sided
comparison against `LAST_CHECK_KEY`, and it is worth fixing both in one pass.

Regression Tests Required:
Extract the decision as `fn should_check(last: Option<i64>, now: i64, force:
bool) -> bool` and assert: no stamp → check; stamp 1 h ago → skip; stamp 25 h ago
→ check; stamp *ahead* of now → check; `force` → check regardless. This is the
same extraction B2-03 needs, so one helper closes both.

Confidence: HIGH
Source: found during adversarial verification

---

ID: B2-14
Severity: P4
Category: INVESTIGATION

File: /home/user/Karasu/src-tauri/src/commands/update.rs
Line: 533 (the only `portable::` call in the file)
Function: `download_pending_update` / `install_pending_update`

Problem:
The updater never asks whether this is a portable install. `commands/update.rs`
calls only `crate::portable::running_from_appimage()` (update.rs:533);
`portable::is_portable()` (portable.rs:79-81) is consulted by
`anilist/auth.rs:26,36`, `diagnostics.rs:153`, `commands/system.rs:212` and
`portable.rs:126`, and by nothing in the update path. `can_install(cfg!(target_os
= "linux"), running_from_appimage())` (update.rs:296-298) returns `true`
unconditionally on Windows, so a portable Windows install is offered the update
and runs the NSIS installer with `/UPDATE` (plugin updater.rs:812).

That much is provable. What cannot be established from this machine is the
outcome.

Expected Behavior:
Either the portable install updates itself while preserving `karasu.portable`
and the `data/` folder, or the install is refused with the same kind of note
About already shows for a non-AppImage Linux build.

Actual Behavior:
Unknown. The generated `installer.nsi` is produced by the Tauri CLI at build
time; it is not in the repository and no build tree exists here
(`find . -name "*.nsi"` returns nothing). Without it the following cannot be
answered:
- how `$INSTDIR` resolves under `/UPDATE` for a portable tree that was *copied*
  rather than installed (no
  `Software\Microsoft\Windows\CurrentVersion\Uninstall\...` `InstallLocation`
  value to read), versus the far more common shape where the user enabled
  portable mode from Settings inside an NSIS-installed app
  (`commands/system.rs:229-250`, `enable_portable`) so the registry entry does
  exist;
- whether the installer's update path removes files in `$INSTDIR` that are not
  in its own manifest — which is what `karasu.portable` and the `data/` folder
  holding `karasu.db` and the DPAPI-sealed `token.dat` are.

Reproduction:
Not reproducible statically. See the next step below.

Impact:
Two sharply different outcomes: preserved (harmless) versus a portable install
whose marker and database are removed on update, which would be silent loss of
the user's local list, overrides and token. The Linux half *is* settled and is
fine: `updater_builder()` sets `executable_path` from `env.appimage` (plugin
lib.rs:90-101), `install_appimage` replaces that file in place (plugin
updater.rs:976-1045), and portable mode's `data/` folder sits *beside* the
`.AppImage` (portable.rs:40-45, 62-66, 101-103), so it is untouched.

Root Cause:
`can_install` was designed around one question — "is there a file to install
into" — and portable mode is a second, independent question about whether the
install is safe, which was never asked.

Recommended Fix (not yet a fix — the experiment comes first):
Install a release build on Windows, enable portable mode from Settings, publish
a bumped rolling build, and run the in-app update; then check whether
`karasu.portable` and `data/karasu.db` survive. If they do not, refuse the
install when `is_portable()` and show the same kind of note About already shows
for a non-AppImage Linux build (`about.updateAppImageOnly`).

Regression Tests Required:
Once the outcome is known: a unit test over a widened predicate
(`fn can_install(is_linux: bool, from_appimage: bool, is_portable: bool)`)
asserting the portable Windows case, alongside the existing Windows-first
assertion at update.rs:339-348.

Confidence: LOW for the impact; HIGH that the updater does not consider portable
mode.
Verification: downgraded from P3 — the impact half cannot be established from
this tree (no generated `installer.nsi`), and an unestablished impact cannot
carry a "real bug" weight. Filed pending the manual experiment.

---

ID: B2-03
Severity: P4
Category: BUG

File: /home/user/Karasu/src-tauri/src/commands/update.rs
Line: 169 (the `kv_set`), 190-192 (`is_success` guard), 194-198 (parse)
Function: `check_for_updates`

Problem:
The 24-hour throttle stamp is written as soon as the HTTP *response* arrives,
before the status code is checked and before the body is parsed. The comment
immediately above it (update.rs:165-168) states the intent as "a check that
failed — offline, DNS not up yet — burned the whole day". That intent is
honoured for transport failures and violated for response failures.

Expected Behavior:
A check that does not yield a usable manifest should not consume the day's
automatic check.

Actual Behavior:
```rust
let resp = ...send().await.map_err(...)?;                 // transport failure: returns before the stamp — correct
let _ = db.kv_set("last_update_check_ms", &now_ms().to_string());   // 169: stamped here
...
if !resp.status().is_success() { return Err(...) }        // 190: HTTP 500/502/503 — stamp already burned
let body: Value = resp.json().await.map_err(...)?;        // 194: truncated / invalid JSON — stamp already burned
let latest = body.get("version")...ok_or("Update manifest has no version")?;  // 198: same
```

Reproduction:
1. GitHub returns 502 for `releases/download/latest/latest.json` (or the object
   store serves a truncated body) at the moment of an autostart launch.
2. `check_for_updates(force: false)` stamps `last_update_check_ms`, then returns
   `Err`.
3. `src/app/App.tsx:139-148` swallows it (`.catch(() => {})`), so nothing appears
   on screen.
4. Every launch for the next 24 h returns the early `Ok` at update.rs:134-140
   without touching the network.

Impact:
A transient GitHub hiccup costs one automatic check. The throttle window is 24 h
either way, so the worst case is an update noticed a day later; manual checks
pass `force: true` (About.tsx:270) and are unaffected, and the state self-heals
with no user action.

Root Cause:
The stamp was moved from "on entry" to "after `send()`" to fix the offline case,
and the two later failure exits were not considered.

Recommended Fix:
Move the `kv_set` so it runs only on the paths that return `Ok` — immediately
before the 404 `return Ok(...)` at update.rs:182 and before the final `Ok(...)`
at 248 — or gate it on `resp.status().is_success()`.

Regression Tests Required:
The command is not testable in isolation (it takes `State<Db>` and does its own
I/O). Extract the throttle decision and the stamp point into a pure helper
(`fn should_check(...)` plus an explicit `enum CheckOutcome { Ok, Transient }`)
and assert that a `Transient` outcome does not stamp — the same extraction
B2-16 requires. A `mem_db()` integration test around the kv would also do.

Confidence: HIGH
Verification: downgraded from P3 — the blast radius is one lost *automatic*
check, the window is 24 h either way, the manual check is unaffected, and it
self-heals. A correctness wart, not a moderate bug.

---

ID: B2-10
Severity: P4
Category: IMPROVEMENT

File: /home/user/Karasu/src-tauri/src/commands/update.rs
Line: 59-76
Function: `set_update_channel`

Problem:
`set_update_channel` clears the pending download and the throttle, with a comment
explaining why both belong to the channel that produced them, but leaves
`last_notified_update_version` and the `update` bell rows in place.

Expected Behavior:
A bell row announcing a build the newly selected channel does not have should
not survive the switch, for the same reason the stash and the throttle do not.

Actual Behavior:
```rust
*pending.0.guard() = None;
db.kv_delete("last_update_check_ms");
db.kv_set("update_channel", &channel)
```
`clear_stale_update_notice` cannot clean it up later either: it returns early
while `version_gt(&notified, &app_version_string())` (update.rs:324), which stays
true for an announced-but-uninstalled version.

Reproduction:
1. On `prerelease`, let an update be announced (bell row present, not installed).
2. Switch to `stable` in Settings — a channel with no releases today, which is
   the whole reason `channel_empty` exists.
3. Press the surviving bell row.

Impact:
`Bell.tsx:386-401` runs `downloadPendingUpdate()` then `installPendingUpdate()`.
The plugin's `check()` 404s on `releases/latest/download/latest.json`, the catch
shows an error toast, and the user gets a failure off a row that looks
legitimate.

Root Cause:
Two of the three channel-scoped pieces of state were identified; the third was
not.

Recommended Fix:
Add `db.kv_delete("last_notified_update_version");` and
`let _ = db.notif_clear_kind("update");` beside the existing two lines.

Regression Tests Required:
A `mem_db()` test asserting all four keys/rows are gone after a channel change.

Confidence: HIGH

---

ID: B2-08
Severity: P4
Category: BUG

File: /home/user/Karasu/scripts/release/release-notes.ps1
Line: 50-65 (`$boilerplate`), 67-80 (the `-Android` splice)
Function: `release-notes.ps1`

Problem:
The Linux paragraph in the release body is unconditional, while the Android one
is conditional on APKs actually being present. On any release where
`build-linux` failed or its artifact did not come down, the release page
describes a download it does not carry.

Expected Behavior:
The notes describe the assets the release actually has — the rule the `-Android`
switch already encodes, and whose absence for Android is recorded as a shipped
bug ("which is how the first signed release shipped its APKs with notes that
never mentioned them", release.yml:341-345).

Actual Behavior:
`$boilerplate` (release-notes.ps1:50-65) always contains the
"**Linux** -- the `.AppImage`, x86_64" paragraph, while release.yml:341-354 sets
`-Android` only from an actual probe of `android-artifacts`. Meanwhile
release.yml:385-390 lists `linux-artifacts/*.AppImage` in the publish step, which
matches nothing when the Linux leg failed (`softprops/action-gh-release` warns
and continues; `fail_on_unmatched_files` is not set), and the prune step's
`$keep` gains an AppImage name only when one is present (release.yml:422-424), so
the *previous* AppImage is deleted too.

Reproduction:
Push to `main` with `build-linux` failing (a Linux-only compile error, an apt
hiccup, a runner timeout). The published `latest` release then has a Windows
installer, no AppImage at all, a `latest.json` without `linux-x86_64`, and
release notes with a full paragraph explaining how to run the AppImage and which
webkit2gtk to install.

Impact:
A Linux visitor to the release page is told which file to download and finds it
absent; combined with B2-02 the in-app updater simultaneously tells them they are
up to date. The defect is release-page copy, wrong only in an already-degraded
state, and it misleads for one release cycle. The asset deletion it rides along
with is arguably correct — an AppImage from an older commit that the current
`SHA256SUMS.txt` no longer lists would be worse.

Root Cause:
The conditional-paragraph pattern was introduced for Android and not
generalised.

Recommended Fix:
Add a `-Linux` switch mirroring `-Android`, set from the same
`Get-ChildItem -Path "linux-artifacts" -Filter *.AppImage` probe the checksum and
prune steps already perform, and splice the Linux paragraph the same way.

Regression Tests Required:
A pwsh test invoking `release-notes.ps1` with and without `-Linux`/`-Android` and
asserting the presence/absence of each paragraph in the output file.

Confidence: HIGH
Verification: downgraded from P3 — the defect is release-page copy in an
already-degraded case, misleading a visitor for one cycle; a cosmetic inaccuracy
rather than a moderate bug.

---

ID: B2-09
Severity: P4
Category: BUG

File: /home/user/Karasu/.github/workflows/release.yml
Line: 366-374 (`Move the rolling tag to this commit`), 378-390 (`Publish release`)
Function: the `build-and-publish` job's step ordering

Problem:
On a rolling run the `latest` git tag is force-moved to `GITHUB_SHA` *before* the
release is published. If the publish step then fails, the tag points at a commit
whose assets were never uploaded.

Expected Behavior:
The tag and the assets it labels move together, or the tag moves last.

Actual Behavior:
Step order in the job is: … → `Compose release notes` → `Move the rolling tag to
this commit` (:366-374, a forced `PATCH` of `refs/tags/latest` to `GITHUB_SHA`) →
`Publish release` (:378-390) → `Prune stale release assets` (:404). A failure in
`Publish release` (rate limit, upload 5xx, cancellation between the two) leaves
the `latest` tag on commit N while the attached installer, `latest.json` and
`SHA256SUMS.txt` are still commit N-1's.

Reproduction:
Any run where `Publish release` fails after the tag move — a GitHub API 5xx or a
cancellation landing in the seconds between the two steps.

Impact:
The release page pairs GitHub's auto-generated source archives for commit N with
binaries from N-1 — which is the exact defect the tag move was introduced to fix
(release.yml:356-365: "the release paired a current installer with source from
months earlier"), reintroduced with a much shorter window. Self-healing on the
next successful push, and no updater client is affected: `latest.json` and its
`url` remain internally consistent.

Root Cause:
Ordering: the fix for the stale-tag problem was placed before the operation it
describes rather than after it.

Recommended Fix:
Move the `Move the rolling tag` step to immediately after `Publish release`
(still before `Prune`). `softprops/action-gh-release` reuses an existing tag
rather than requiring it to point anywhere in particular, so nothing depends on
the current order.

Regression Tests Required:
None practical; this is a step-ordering change with a comment recording why.

Confidence: HIGH

---

ID: B2-17
Severity: P4
Category: BUG

File: /home/user/Karasu/src-tauri/gen/android/app/build.gradle.kts
Line: 34-35; /home/user/Karasu/src-tauri/tauri.conf.json:4;
/home/user/Karasu/.github/workflows/release.yml:553-575
Function: the `android-build` job's release APK production

Problem:
The four-part version's monotonicity does not reach the APK. `build.gradle.kts`
takes both identifiers from Tauri's generated properties:

```kotlin
versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
```

Tauri derives those from the semver core in `tauri.conf.json:4`
(`"version": "0.190.0"`), which `bump-version.mjs` only touches on a
major/minor/patch bump. `COMMIT_NUMBER` — the segment that moves on *every*
commit — is not part of either value.

Expected Behavior:
Two published APKs that are different builds should be distinguishable to the
platform, not only to a human reading the filename.

Actual Behavior:
Only the *filename* carries the full four-part version:
`rename-apk.ps1:53-64` reads `COMMIT_NUMBER` out of `update.rs` and emits
`Karasu_<MAJOR.MINOR.PATCH.COMMIT#>_<flavor>.apk`. Inside the package,
`versionCode` and `versionName` are identical between any two builds whose only
difference is `COMMIT_NUMBER`.

Reproduction:
1. Build and publish release APKs at `0.190.0.498`.
2. Land a commit-only bump to `0.190.0.499` and publish again.
3. The two APKs have different filenames, the same `versionName` (`0.190.0`) and
   the same `versionCode`.

Impact:
Android treats the two as the same version: the OS reports no update, `pm
install` without `-r` refuses, and anything keying off `versionCode` — a store,
a sideload helper, a device-management tool — cannot order the two builds.
Karasu deliberately has no Android updater (`updater_available()` answers false
on mobile, and the manifest generator knows nothing about Android on purpose),
so nothing in the app is broken by this; it is a gap in the versioning scheme
that is nowhere written down.

Root Cause:
The four-part scheme lives in two places — the three semver manifests and
`COMMIT_NUMBER` — and Tauri's Android version derivation can only see the first.
The rename script papers over it at the filename level, which made the gap
invisible.

Recommended Fix:
Either set `tauri.android.versionCode` explicitly from the four-part version
(e.g. `major*1_000_000 + minor*10_000 + patch*1_000 + commit`, keeping it
monotonic and within Android's 2,100,000,000 ceiling) as part of
`bump-version.mjs`'s write set, or — if that is judged not worth it for a
sideload-only target — record the decision in CLAUDE.md beside the "Android has
no updater" note, so the next reader does not assume the APK carries the commit
number the filename shows.

Regression Tests Required:
If the versionCode is made to move: a node test asserting the derivation is
strictly increasing across a sequence of four-part versions
(`0.190.0.498` < `0.190.0.499` < `0.190.1.500` < `0.191.0.501`) and stays under
Android's ceiling.

Confidence: HIGH
Source: found during adversarial verification

---

ID: B2-07
Severity: P4
Category: BUG

File: /home/user/Karasu/scripts/bump-version.mjs
Line: 94-113
Function: `writeAll`

Problem:
`writeAll`'s rollback restores every file in `done` — the files written *before*
the one that threw — but not the file that threw. `writeFileSync` on a full or
failing filesystem can leave the target truncated or partially written; that file
is then neither the old content nor the new one, and no message names it.

Expected Behavior:
Either every file is old or every file is new; if neither can be achieved, the
report should name every file whose state is unknown, including the one that
failed.

Actual Behavior:
```js
for (const w of writes) {
  writeFileSync(w.path, w.after);
  done.push(w);            // :99 — only reached on success
}
} catch (e) {
  for (const w of done) { ... writeFileSync(w.path, w.before); }   // :102
  ...
  fail(`writing ${relative(ROOT, e.path ?? "")} failed: ${e.message}`);   // :111
}
```
The failing `w` is never pushed to `done`, so it is never restored, and the
failure message says "failed", not "may be partially written".

Reproduction:
Fill the filesystem so that the third `writeFileSync` (`Cargo.toml`) fails after
emitting part of the buffer. `package.json` and `tauri.conf.json` are restored;
`Cargo.toml` is left truncated; `Cargo.lock` and `update.rs` are untouched. The
tree is now in the state B2-06 describes.

Impact:
Low likelihood — a partial `writeFileSync` needs ENOSPC or EIO mid-write — but
the outcome is precisely the version skew B2-06 turns into an update loop, and
the failure message points at the file without saying it may be damaged.

Root Cause:
`done` tracks completed writes; the rollback loop uses it as if it tracked
*attempted* writes.

Recommended Fix:
Push `w` onto `done` *before* the write, or keep a separate `attempted` list, and
restore from that. Also mention the file explicitly in the failure message
("`X` may be partially written — restore it from git before retrying").

Regression Tests Required:
A node test that stubs `writeFileSync` to throw on the Nth call and asserts all N
files hold their original bytes afterwards.

Confidence: HIGH

---

ID: B2-13
Severity: P4
Category: CODE SMELL

File: /home/user/Karasu/scripts/release/generate-update-manifest.ps1
Line: 123 (`$manifest | ConvertTo-Json -Depth 5 | Out-File -FilePath $outPath -Encoding utf8`)
Function: `generate-update-manifest.ps1`

Problem:
`latest.json` is the one file in `scripts/release/` written with
`Out-File -Encoding utf8` rather than the explicit BOM-less form its two siblings
use (`release-notes.ps1:129-136` and the workflow's checksum step at
release.yml:306-316 both do
`[IO.File]::WriteAllText(..., [Text.UTF8Encoding]::new($false))`, each with a
comment saying why).

Expected Behavior:
`latest.json` is written UTF-8 without a BOM, deterministically, whichever
PowerShell runs the script.

Actual Behavior:
`-Encoding utf8` means UTF8**NoBOM** in PowerShell 7 and UTF8**BOM** in Windows
PowerShell 5.1. The workflow step sets `shell: pwsh` (release.yml:278), so CI is
correct today. A BOM would make `serde_json` fail on the first byte, so *every*
client's `check_for_updates` (update.rs:194) and the plugin's own manifest parse
would error.

Reproduction:
`powershell -File scripts/release/generate-update-manifest.ps1` (Windows
PowerShell 5.1) produces a BOM-prefixed `latest.json`. `package.json`'s
`tauri:build:win` script invokes a sibling release script with exactly that
interpreter (`"tauri build && powershell -ExecutionPolicy Bypass -File
scripts/release/rename-installer.ps1"`), so 5.1 is a shell someone plausibly
reaches for in this directory.

Impact:
Latent only, given `shell: pwsh`. Recorded because the encoding hazard is already
recognised twice in this directory and the manifest — the file where a parse
failure breaks updates for everyone at once — is the one that did not get the
treatment.

Root Cause:
Inconsistency between three files that write text for non-Windows readers.

Recommended Fix:
`[IO.File]::WriteAllText($outPath, ($manifest | ConvertTo-Json -Depth 5),
[Text.UTF8Encoding]::new($false))`.

Regression Tests Required:
None; the change is the guard.

Confidence: HIGH

---

ID: B2-12
Severity: P4
Category: CODE SMELL

File: /home/user/Karasu/scripts/release/rename-installer.ps1
Line: 53; same shape at /home/user/Karasu/scripts/release/rename-appimage.ps1:54
Function: `rename-installer.ps1`, `rename-appimage.ps1`

Problem:
PowerShell's `-replace` treats the *replacement* operand as a substitution string
in which `$1`, `$&`, `$$` and `${name}` are live. The *pattern* is escaped with
`[regex]::Escape($packageVersion)`; the replacement is not, and it embeds a
tag-derived `$Suffix`:

```powershell
$fullVersion = "$packageVersion.$commitNumber"
if ($Suffix) { $fullVersion = "$fullVersion-$Suffix" }
$newName = $installer.Name -replace [regex]::Escape($packageVersion), $fullVersion
```

`$Suffix` comes from the git tag (release.yml:98-104, :191, :266-267).

Expected Behavior:
The suffix appears in the filename verbatim.

Actual Behavior:
For a tag like `v1.0.0-rc$1`, `$Suffix` is `rc$1` and the replacement expands
`$1` (an unset capture group → empty), producing
`Karasu_1.0.0.500-rc_x64-setup.exe`. The prune step's `$keep` is populated from
this script's `GITHUB_OUTPUT`, so the names stay consistent and nothing is
deleted wrongly — the release simply ships an installer whose name silently
dropped part of the tag. `rename-apk.ps1:60` builds its name by interpolation and
is not affected.

Reproduction:
`./scripts/release/rename-installer.ps1 -Suffix 'rc$1'`.

Impact:
Cosmetic and maintainer-controlled: git tags are the only input, and the
project's tags are `vX.Y.Z[-suffix]`. Recorded because release.yml:404-424 already
documents this exact class of PowerShell hazard as a real one for a filename, and
this is the same hazard one file over.

Root Cause:
A value that flows in from outside is used as a regex replacement string.

Recommended Fix:
Use `$installer.Name.Replace($packageVersion, $fullVersion)` — a plain string
replace with no substitution syntax — or escape the replacement explicitly.

Regression Tests Required:
A pwsh test asserting `-Suffix 'rc$1'` yields a name containing the literal
`rc$1`.

Confidence: HIGH

---

ID: B2-11
Severity: P4
Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/src-tauri/src/commands/update.rs
Line: 275-298, and 512-514
Function: `can_install` / `updater_available`

Problem:
Two inaccuracies in the file's own comments, both in load-bearing places.

1. The doc comment describing `can_install` is attached to `updater_available`.
   Lines 275-283 describe `can_install`'s two arguments and why the `is_linux`
   half exists; lines 284-285 then open a *second* doc paragraph ("Whether the
   updater plugin exists in this build at all") and the whole block lands on
   `#[cfg(desktop)] fn updater_available()` at :286-289. `fn can_install` at :296
   has no doc comment at all. That comment is the only record of why the
   predicate takes two arguments instead of reading the world.

2. `update.rs:512-514` claims that on a platform without the updater "the About
   button reports 'nothing downloaded'". No code does that:
   `download_pending_update` returns `Ok(None)` (:521), `About.tsx:253-264`
   (`startDownload`) sets `downloaded` to `null` with no error, and the card
   renders nothing new. The user-facing outcome is still honest, because
   `About.tsx:363-366` shows `about.updateAppImageOnly` permanently for a
   non-AppImage Linux build and `about.updateAndroidHint` on Android — but that
   disclosure is unrelated to the sentence quoted.

Expected Behavior:
Comments describe the item they are attached to.

Actual Behavior:
As above.

Reproduction:
Read update.rs:275-298 and :512-514.

Impact:
None at runtime. It matters because the misplaced paragraph is the *only*
explanation of a predicate whose own comment says its shape "is the whole risk",
and a future reader deleting `updater_available`'s doc would take it with them.

Root Cause:
A doc block was inserted between an existing comment and its function.

Recommended Fix:
Split the block — lines 275-283 above `fn can_install`, lines 284-285 above the
`updater_available` pair — and reword 512-514 to say the About page shows the
platform note instead.

Regression Tests Required:
None.

Confidence: HIGH

---

## Update scenario matrix

Every row below was traced statically against the code and the vendored plugin.
**No update was actually installed during this audit**, and no build was run;
the portable row in particular is an unresolved question rather than a traced
outcome. Running build throughout: `0.190.0.498` (`CARGO_PKG_VERSION = 0.190.0`
from `Cargo.toml`, `COMMIT_NUMBER = 498` at update.rs:13).

| Scenario | Traced outcome | Correct? |
|---|---|---|
| Same version offered (`0.190.0+498`) | `version_parts` maps `+` and `.` alike (update.rs:263-267); `version_gt` returns `false` on equality → `isNewer: false`. Comparator: `remote_is_newer((0,190,0,498),(0,190,0))` = `(0,190,0,498) > (0,190,0,498)` = `false` → `check()` returns `None` → `Ok(None)` | **Yes — no loop.** Pinned by `remote_is_newer_uses_the_running_commit_number` and `the_manifest_spelling_compares_equal_to_the_dotted_one` |
| Patch update (`0.190.1+499`) | `version_gt` true, platform key present → `isNewer: true`; comparator true → download → minisign verify → stash | Yes |
| Commit-only update (`0.190.0+499`) | `version_gt([0,190,0,499],[0,190,0,498])` → true; `(0,190,0,499) > (0,190,0,498)` → true | Yes; pinned by `build_metadata_reads_as_the_fourth_segment` |
| Older version offered (`0.189.0+600`) | `version_gt` compares left to right → `189 < 190` → false; tuple compare → false | **Yes — no downgrade** |
| Malformed manifest (bad JSON / no `version`) | `resp.json()` or `ok_or` → `Err`; the plugin's own deserializer errors and surfaces on About. **The throttle was already stamped** | Fails closed, but see B2-03 |
| Bad `pub_date` in the manifest | Not read by `check_for_updates`; the plugin's `RemoteRelease` deserializer hard-fails on a non-RFC3339 `pub_date` (plugin updater.rs:1402-1408). The generator emits `yyyy-MM-ddTHH:mm:ssZ`, which is valid | Yes |
| Signature verification failure | `verify_signature(&buffer, &self.signature, &self.config.pubkey)` runs at the *end* of `download` (plugin updater.rs:712), before any bytes are returned; `download_pending_update` never reaches the stash write or the notify | **Yes — fail-closed** |
| Interrupted download | `stream.next()` yields `Err` → `?` → `Err`; the stash is untouched, so a prior good download is not lost | Yes, but see B2-05 (no timeout bounds a *stall*) |
| Failed install | `install_pending_update` holds the guard across `update.install(bytes)` and returns `Err` without taking the bytes (update.rs:642-646), so the stash survives and the About button stays | **Yes**, deliberately so per the comment at :636-641 |
| Portable install (Windows) | `can_install(cfg!(target_os = "linux"), running_from_appimage())` is `true` unconditionally on Windows; `is_portable()` is never consulted; the NSIS installer runs with `/UPDATE` | **Unresolved** — see B2-14. Whether `karasu.portable` and `data/` survive cannot be determined without the generated `installer.nsi` |
| Portable install (Linux AppImage) | `executable_path` comes from `env.appimage` (plugin lib.rs:90-101), `install_appimage` replaces that file in place (plugin updater.rs:976-1045), and portable `data/` sits beside the `.AppImage` (portable.rs:40-45, 62-66) | Yes |
| Linux without an AppImage signature (no `linux-x86_64` in the manifest) | `has_platform` false → `isNewer: false`, `channelEmpty: false` → About renders the green tick. The plugin's `get_urls` runs *before* `should_update` (plugin updater.rs:534), so a direct `check()` would return `Err(TargetNotFound)` rather than `None` | **No** — see B2-02 |
| Android | `check_for_updates` runs and posts a bell row, guarded on `last_notified_update_version` (update.rs:234-246); `App.tsx:144-146` skips `downloadPendingUpdate()` for Android; `download_pending_update` would return `Ok(None)` anyway via `updater_available()` (`#[cfg(mobile)]` → false) before touching `updater_builder()`, which would otherwise panic | Yes, by design — but `versionCode` does not move on a commit-only bump (B2-17) |

**Specifically asked: can running `0.190.0.498` be offered `0.190.0+498`?** No, on
both paths, and both are pinned by tests. `version_gt` (update.rs:301-311) returns
`false` when all segments are equal; `remote_is_newer` (update.rs:480-483) is a
strict `>` on a 4-tuple whose fourth element is the compile-time `COMMIT_NUMBER`,
not anything the plugin derived from `Cargo.toml`. The loop the
`version_comparator` exists to prevent is prevented. The only route back to a loop
is a *version-file mismatch*, which is B2-06.

---

## Verified sound

Scenarios checked and found correct, with the guard that handles each:

- **The self-reinstall loop.** `version_comparator` in `download_pending_update`
  (update.rs:563-573) plus `remote_is_newer` (:480). The plugin's default
  (`release.version > self.current_version`, plugin updater.rs:532) would compare
  `0.190.0+498` against a build-metadata-free `0.190.0` from `package_info()` and
  loop; the explicit comparator supplies `COMMIT_NUMBER`. Pinned by the test at
  update.rs:421-433.
- **`+` versus `.` version spellings.** `version_parts` splits on both
  (update.rs:263-267). Pinned by
  `the_manifest_spelling_compares_equal_to_the_dotted_one` (:359-376), which also
  asserts the manifest's *shape* — exactly one `+`, a three-part core, digits
  after — so a "tidy" back to a dot fails the suite.
- **A non-numeric rolling tag.** `version_gt("latest", ...)` → all segments parse
  to 0 → false. Pinned by `non_numeric_tag_never_reports_an_update` (:395-399),
  and the reason `check_for_updates` reads the manifest rather than the tag name.
- **The Linux "nothing to install into" gate.** `can_install(is_linux,
  from_appimage)` (:296-298), called with `cfg!(target_os = "linux")` so Windows
  short-circuits to `true`. The test at :339-348 asserts the Windows case *first*
  and says why. The refusal happens before the ~100 MB download and before the
  notification.
- **The mobile gate.** `updater_available()` is a `#[cfg(desktop)]` /
  `#[cfg(mobile)]` pair (:286-294) checked *before* `app.updater_builder()`, which
  would otherwise panic reaching for state the plugin never registered on Android
  (`attach_desktop`, lib.rs:538-565).
- **Update signature verification.** `Update::download` verifies against the
  pubkey in `tauri.conf.json` before returning any bytes (plugin updater.rs:712),
  and `install_pending_update` can only install bytes that came from there.
- **`check_for_updates` cannot cause an unsigned install.** It is a plain HTTPS
  GET parsed for one string; a tampered manifest can only lie about the version
  shown on the About page. Every byte that reaches `install` went through the
  plugin's minisign check.
- **The WebView cannot reach the updater plugin.** `capabilities/default.json`
  grants `core:default`, four `opener`/`window` permissions and
  `deep-link:default` — **not** `updater:default`. So `plugin:updater|check` and
  `|install` (which would use the plugin's default comparator and loop) are
  unreachable from JS, and the update path is only the four Rust commands. The
  capability file documents this deliberately.
- **A poisoned `PendingUpdate` mutex.** `pending.0.guard()` goes through `LockExt`
  (sync.rs:29-33), which takes the guard through a poisoning rather than
  panicking.
- **Failed install keeps the download.** `install_pending_update` borrows rather
  than takes (update.rs:642-646); the comment records the exact regression this
  fixed.
- **Windows install does not return.** `install_inner` ends in
  `std::process::exit(0)` after `ShellExecuteW` (plugin updater.rs:864-866), so
  `app.restart()` on update.rs:648 is the Linux path only — matching the doc at
  :629-630.
- **AppImage self-replacement.** `updater_builder()` sets `executable_path` from
  `env.appimage` (plugin lib.rs:90-101), so `extract_path` is the real `.AppImage`
  file and not the throwaway `/tmp/.mount_*` binary — the same trap `portable.rs`'s
  `base_dir`/`plausible_appimage` guard for the data folder.
- **404 is not "up to date".** `channel_empty` (update.rs:181-189) and the gold
  warning branch in `About.tsx:336-338`.
- **Non-AppImage Linux is disclosed.** `About.tsx:363-366` renders
  `about.updateAppImageOnly` permanently whenever `isLinux(platform) &&
  !platform?.appImage`, so the silent `Ok(None)` at update.rs:533-540 is not a
  bare dead end.
- **Channel switch invalidates the stash and the throttle.** `set_update_channel`
  (:59-76). (The third piece of state is B2-10.)
- **`bump-version.mjs` regexes still match their targets.** Verified against the
  current files: `package.json:4` `"version": "0.190.0",` (the only `"version"`
  key at any depth — no dependency is named `version`); `tauri.conf.json:4`
  likewise; `Cargo.toml:3` `version = "0.190.0"` is the first line-anchored match,
  ahead of every dependency table; `Cargo.lock:2327-2328` `name = "karasu"` /
  `version = "0.190.0"` is unique; `update.rs:13` is the only
  `COMMIT_NUMBER: u32 = N;`.
- **`bump-version.mjs` cannot half-write on a pattern miss.** All five `plan()`
  calls are evaluated as arguments before `writeAll` is entered, and `plan` calls
  `fail()` → `process.exit(1)` on a miss or a no-op. The `Cargo.lock` edit is
  anchored to `name = "karasu"\r?\nversion = ` and rewrites only the quoted core,
  so it cannot corrupt the lockfile; a mid-merge lockfile simply misses and aborts
  everything. (The one residual gap is B2-07.)
- **`bump-version.mjs` uses replacement *functions*, not strings.** `plan` takes a
  function (:68-78), which is what keeps `$1`/`$&` inert — the hazard B2-12 finds
  in the PowerShell twins.
- **`release-notes.ps1` bounds check.** `if ($start -ge $end) { throw }` precedes
  the `$lines[$start..($end - 1)]` slice, which is required because PowerShell's
  `..` silently *reverses* when the end is below the start. The emptiness guard
  after the slice is a second net. The tag path also pre-checks the CHANGELOG in
  `Resolve release target` (release.yml:199) before the ~15-minute build.
- **Release notes are passed as a file, never a `${{ }}` expression.**
  `body_path: notes.md`, and every script argument carrying outside data
  (`RELEASE_TAG`, `RELEASE_NAME`, `NOTES_VERSION`, `NOTES_SHA`, `INSTALLER`,
  `GITHUB_REF`) is read through `$env:` inside the script rather than substituted
  into the script text. This closes the injection class in the job that holds the
  signing key. Each of the four places carries a comment saying so.
- **Signature sibling renames fail closed.** All three rename scripts set
  `$ErrorActionPreference = "Stop"`, so a failed `Rename-Item` on a `.sig` throws
  and fails the step. On Windows the missing `.sig` is caught a second time by
  `generate-update-manifest.ps1:49-51`, which throws — so a Windows release can
  never publish an unsigned installer with a manifest. (Linux is B2-02.)
- **`rename-appimage.ps1`'s sibling loop.** `$siblings` is fully enumerated before
  the `Rename-Item`, and `$appimage.Name` is a cached `FileInfo` property that an
  external rename does not refresh, so `$s.Name.Substring($appimage.Name.Length)`
  is still computed against the *old* name. `$tail` is deliberately not `$suffix`
  (PowerShell variables are case-insensitive, so it would clobber the `$Suffix`
  parameter) — the comment records this.
- **Prune is guarded by `rolling == 'true'`,** so a tag build can never compute
  `$keep` from its own filenames and delete the rolling installer.
- **Prune collects deletion failures** rather than letting the wrapper's single
  `exit $LASTEXITCODE` report only the last call (release.yml:434-447).
- **Concurrency.** `group: release-${{ github.ref }}` with `cancel-in-progress`.
  Two pushes to `main` share a group, so run A is *cancelled* — and
  `if: ${{ !cancelled() }}` (not `always()`) then skips `build-and-publish` for A,
  so A cannot publish an older build over B or prune B's assets. A `main` push and
  a `v*` tag push land in different groups and run concurrently, but the tag run
  neither moves `latest` nor prunes it, and publishes under its own tag — no
  shared mutable state.
- **Artifacts are per-run.** `actions/download-artifact` with `name:` and no
  `run-id:`/`github-token:` reads only the current run's artifacts, so
  `linux-artifacts/` can never contain a stale AppImage from an earlier run.
- **Secrets cannot reach the logs.** `HAS_ANDROID_KEYSTORE` is a boolean
  expression (`secrets.ANDROID_KEYSTORE_B64 != ''`), never the value. The keystore
  is written with `[IO.File]::WriteAllBytes` and `key.properties` with
  `WriteAllLines`, neither echoed; `key.properties` is covered by
  `src-tauri/gen/android/.gitignore`. The only artifact uploaded from that job is
  `android-apks/*.apk`. `latest.json` and `SHA256SUMS.txt` are in the root
  `.gitignore`, so a release artifact cannot be accidentally committed.
- **Permissions are least-privilege.** Workflow-level `contents: read`; only
  `build-and-publish` is granted `contents: write`. `build-linux` and
  `android-build` run `npm ci` and third-party actions without a writable token.
- **`main` cannot ship untested code.** `ci.yml` runs only on `pull_request`, but
  `release.yml` runs the identical `npm run verify` line in **both**
  `build-linux` (ubuntu-22.04) and `build-and-publish` (windows-latest), and in
  the latter it runs *before* `Build release` and therefore before every
  publishing step. A verify failure on either OS blocks the release.
  `android-build` runs no verify — it is a compile check for a target
  `npm run verify` cannot see, which is its stated purpose.
- **`createUpdaterArtifacts` fails closed on Windows.** `tauri.conf.json` sets it
  `false`; the workflow overrides it per build with
  `--config '{"bundle":{"createUpdaterArtifacts":true}}'`. If that override ever
  fails to apply, the build succeeds but produces no `.sig`, and
  `generate-update-manifest.ps1:49-51` throws — so no release is published rather
  than an unsigned one. (The Linux leg has no such backstop; that is B2-02.)
- **No `#[cfg(target_os = "...")]` on a statement.** Every one of the 18 hits
  under `src-tauri/src/` decorates an item — a `mod`, a `const`, or one half of a
  cfg'd function pair (`sessions_result`, `connect`, `protect`/`unprotect`,
  `delete_portable_key`, `toast_with_action`, `linux_info`,
  `avoid_blank_webkit_window`). `portable.rs:51-62` is a cfg'd pair of tail blocks
  inside `appimage_path`, with the pure decision (`plausible_appimage`,
  `base_dir`) lifted out and tested on both platforms.
- **`cfg(mobile)`/`cfg(desktop)` consistency.** `attach_desktop` (lib.rs:538/566),
  `updater_available` (update.rs:286/291), `portable::remember_data_dir`
  (portable.rs:105/111) and `connect` (mpv_ipc.rs:159/169) are all complete pairs,
  so every call site type-checks on both.
- **`debug_assertions` divergence is a pair or a runtime `if`.**
  `hide_window_in_dev` is `#[cfg(all(desktop, debug_assertions))]` /
  `#[cfg(all(desktop, not(debug_assertions)))]` (lib.rs:183/195) with a comment
  stating exactly why a cfg'd statement was rejected; `alerts/notify.rs:187` uses
  `cfg!(debug_assertions)` in an `if`, so both arms compile in both profiles;
  `main.rs:2` is the `windows_subsystem` attribute.
- **Functions kept alive only by `cfg(test)` are annotated.** Every one found
  carries an explicit `#[cfg_attr(not(...), allow(dead_code))]`:
  `portable::plausible_appimage` (portable.rs:27), two in
  `playback/detection/media_session/mod.rs` (41, 229),
  `diagnostics::parse_os_release` (diagnostics.rs:77) — the known one —
  `widgets.rs:169`, four in `keystore.rs` (31, 35, 45, 57) and two in `i18n.rs`
  (54, 68). Nothing in the update/release surface is in this category:
  `version_parts`, `display_version`, `version_gt`, `can_install`,
  `remote_is_newer`, `updater_available` and `clear_stale_update_notice` all have
  non-test callers.
- **`latest.json` cannot advertise an asset the run did not upload** in the normal
  case: the manifest's `url` is built from `$Tag` and the installer's post-rename
  filename, both produced in the same job as the upload, and the prune step's
  `$keep` contains that same name from `steps.installer.outputs.installer`. The
  `-Tag` parameter is what stops a tagged release's manifest pointing into the
  rolling tag that the prune step empties.
- **The rolling arm performs no CHANGELOG validation, by design.**
  `release.yml:203` publishes with `version=` empty, so `release-notes.ps1` is
  never asked for a CHANGELOG section on a rolling build; the tag path's
  pre-check at :199 is the only CHANGELOG validation in the pipeline, and that is
  the intended shape. (It is the reason B2-01's proposed guard has to be added to
  the `else` arm and not only beside the existing tag check.)

## Refuted during verification

No finding from the original report was refuted. Two were downgraded on the
strength of documented deliberate decisions rather than being withdrawn: B2-02
(the manifest publishing Windows-only when the Linux leg fails is the documented
soft-dependency design at release.yml:136-151 and update.rs:201-205 — only the
client's green tick is the defect) and B2-01 (the trigger is a violation of the
mandatory bump convention that `bump-version.mjs` exists to enforce, not a defect
that fires on its own).

## Counts

| Severity | Count |
|---|---:|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 7 |
| P4 | 10 |
| **Total** | **17** |

Refuted during verification: 0.
