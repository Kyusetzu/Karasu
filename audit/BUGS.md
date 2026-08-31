# Cross-Cutting Bug Register

## Scope

This is the single index of every **functional defect** raised anywhere in the
Karasu pre-release audit. It restates nothing: each row points at the report that
holds the full entry — problem, reproduction, root cause, fix and regression
tests — and exists so the maintainer can see the whole defect surface in one
place, and so defects that were found twice from two directions are counted once.

Reports indexed, all at commit `9a53427`: `ACCOUNT_ISOLATION.md`,
`DATA_INTEGRITY.md`, `SCROBBLING_AUDIT.md`, `SYNC_AUDIT.md`,
`DATABASE_AUDIT.md`, `SECURITY.md`, `UPDATE_AUDIT.md`, `DETECTION_AUDIT.md`,
`UI_UX_AUDIT.md`, `TEST_GAPS.md`, `DEAD_CODE.md`, `LEGAL_CONTENT.md`,
`LIBRARY_AUDIT.md`, `PERFORMANCE.md`. `ARCHITECTURE.md` is a map, not a findings
report, and raises none.

**What is in the table.** Every finding whose category is BUG, DATA INTEGRITY
RISK, SECURITY RISK or ARCHITECTURAL PROBLEM — including compound categories
(`BUG / DATA INTEGRITY RISK`), the one `DATA RETENTION / ACCOUNT ISOLATION`
entry, and PERFORMANCE PROBLEM, which is a functional defect wherever it means
the app hangs, freezes detection or spends a rate-limit budget nobody asked it
to spend.

**What is not.** Pure IMPROVEMENT (20, counting the one ENHANCEMENT),
DOCUMENTATION ISSUE (22), MISSING TEST (21), DEAD CODE (1), CODE SMELL (8),
INVESTIGATION (4), RELEASE HYGIENE (1) and PROCESS (1) — **78 entries** that stay
in their own reports. Two of them are worth naming here even though they are out
of category:

- **C3-09 (P2, RELEASE HYGIENE, `LEGAL_CONTENT.md`)** — the audit reports
  themselves, this file included, are tracked and already pushed to `origin`.
  It is the one item `LEGAL_CONTENT.md` says must be settled before the branch
  merges or the repository is published.
- **The MISSING TEST bucket is not decoration.** `C1-04` (the offline-queue
  drain), `C1-05` (`build_now_playing` / `requeue_match`) and `C1-06` (the
  optimistic cache patch and its rollback split) are the untested halves of the
  three code paths that produce the most P2s below.

**Reading the table.** *ID* carries the canonical id followed by the ids the same
defect was filed under elsewhere, so `A2-15 (=A1-18, =A3-15)` is one defect found
three times. Where two reports disagreed on severity the alias carries its own,
e.g. `(=B4-01 P2)`; the row keeps the severity of the report that holds the full
entry, and the disagreements are listed under the table. *Area* names that
report. *File:Line* is that report's own citation.

**One numbering hazard.** The `A4-` series drifted between reports.
`DATABASE_AUDIT.md` holds all 26 with unique numbers and is authoritative:
`DATA_INTEGRITY.md`'s `A4-20`/`A4-21` are `DATABASE_AUDIT.md`'s `A4-26`/`A4-22`,
and `LIBRARY_AUDIT.md`'s `A4-21`/`A4-22` are its `A4-24`/`A4-26`. Worse,
**`A4-23` names two different defects** — a portable-mode token guarantee in
`DATABASE_AUDIT.md` and a `hydrate` override bug found only while writing
`LIBRARY_AUDIT.md` — so both rows below carry their report name. `PERF-*` is a
parallel numbering of findings that already had ids; only `PERF-04` is unique to
`PERFORMANCE.md`.

**103 distinct functional defects, none of them P0.** Nothing in the audit
destroys user data without a second trigger, ships a secret, or breaks an
install through the updater. The three P1s are an account-crossing cache, a
scrobble session destroyed by an ordinary pause, and an intermittently red
`npm run verify`.

## Findings at a glance

| ID | Severity | Category | Area | File:Line | One-line summary |
|---|---|---|---|---|---|
| A3-01 (=B4-01 P2) | P1 | SECURITY RISK / DATA INTEGRITY RISK | ACCOUNT_ISOLATION.md | `src/stores/auth.ts:149-172` | An identity change never clears the TanStack cache, so account A's list entry — private notes included — renders under B and one Save writes it to B's list |
| B3-01 | P1 | BUG | DETECTION_AUDIT.md | `src-tauri/src/playback/scrobbler.rs:1213` | One tick with nothing detected destroys the scrobble session, so an ordinary pause resets the whole wall-clock threshold on media-session-only players |
| C1-02 | P1 | BUG | TEST_GAPS.md | `src-tauri/src/logging.rs:745` | The one verify gate fails intermittently because two tests share a global panic hook and ring while only one takes the serialising lock |
| A1-01 | P2 | DATA INTEGRITY RISK | ACCOUNT_ISOLATION.md | `src-tauri/src/commands/auth.rs:155-160` | The token and the cached viewer are two unwound writes in the unsafe order, so a failing kv write leaves `token = B, viewer = A` and the drain sends A's queued edits under B's bearer |
| A1-02 | P2 | BUG | DATA_INTEGRITY.md | `src-tauri/src/commands/list.rs:525` | `delete_list_entry` treats a skipped drain as a successful one and deletes live, letting a queued save recreate the entry |
| A1-03 | P2 | DATA INTEGRITY RISK | DATA_INTEGRITY.md | `src-tauri/src/playback/scrobbler.rs:728` | The scrobbler's two "never move progress backwards" guards read a SQLite cache that no manual or bulk save ever updates |
| A1-14 | P2 | DATA INTEGRITY RISK | DATA_INTEGRITY.md | `src-tauri/src/commands/list.rs:516` | A deleted entry is never removed from `list_cache`, so playing that title scrobbles it back into existence |
| A2-01 | P2 | BUG / DATA INTEGRITY RISK | SCROBBLING_AUDIT.md | `src/components/media/NowPlayingCard.tsx:446,458-461` | The correction dialog measures `episode_offset` against the *resolved* episode, so re-picking wipes a working offset and can destroy a relations redirect into a false `COMPLETED` |
| A2-02 (=B3-18 P3) | P2 | BUG | SCROBBLING_AUDIT.md | `src-tauri/src/playback/scrobbler.rs:1143-1148` | Switching "Update progress automatically" off mid-episode does not disarm the running session; it still writes |
| A2-04 | P2 | BUG | SCROBBLING_AUDIT.md | `src-tauri/src/playback/recognition/matcher.rs:115,188-193` | The season-stripped variant participates in the exact-match short circuit, so `Show S2` binds to the season-1 entry whenever that entry comes first in the list |
| A3-02 (=PERF-03) | P2 | BUG / ARCHITECTURAL PROBLEM | SYNC_AUDIT.md | `src-tauri/src/anilist/client.rs:498-517` | The `Retry-After` deadline the limiter records is never consulted by the code that decides whether to send, and the window heal repairs the budget straight through it |
| A3-03 (=PERF-02) | P2 | PERFORMANCE PROBLEM | SYNC_AUDIT.md | `src/app/main.tsx:31-32` | A frontend retry stacks on the Rust retry with no cancellation, so one logical read can cost 4 HTTP requests and ~6 minutes of skeleton |
| A3-04 (=PERF-01) | P2 | BUG | SYNC_AUDIT.md | `src-tauri/src/playback/scrobbler.rs:1008-1073` | The AniList write is awaited inline in the 5 s detection loop, so a slow write or a queue drain freezes detection and can silently miss an episode |
| A3-14 | P2 | BUG | SYNC_AUDIT.md | `src-tauri/src/commands/list.rs:291-307` | The cached-list fallback matches only `ApiError::Network`, so a 429 or a rejected token shows the error page on every list screen even with a complete local list cached |
| A4-02 | P2 | DATA INTEGRITY RISK | DATABASE_AUDIT.md | `src-tauri/src/commands/system.rs:249` | `enable_portable` switches path resolution immediately but keeps writing to the old database, so a session's scrobbles and queued edits vanish on the next launch |
| C1-18 | P2 | BUG | TEST_GAPS.md | `src-tauri/src/logging.rs:683` | `the_ring_is_bounded_and_newest_first` has C1-02's race too, and C1-02's recommended fix does not cover it |
| A1-16 | P3 | BUG | ACCOUNT_ISOLATION.md | `src-tauri/src/commands/auth.rs:160` | `profile_mode` is a third unwound write in `connect_with_token`: if it fails the install holds a valid session while Rust still believes it is in local mode |
| A1-17 | P3 | DATA RETENTION / ACCOUNT ISOLATION | ACCOUNT_ISOLATION.md | `src-tauri/src/commands/auth.rs:207-213` | `anilist_logout` clears the token, the viewer blob and the widget projection but never the signed-out account's cached lists, which no code path deletes |
| A1-05 (=A4-08 P4) | P3 | DATA INTEGRITY RISK | DATA_INTEGRITY.md | `src-tauri/src/db.rs:756` | `update_cached_progress` is a read-modify-write across two lock acquisitions and can discard a freshly fetched list |
| A1-06 (=A3-08) | P3 | BUG | DATA_INTEGRITY.md | `src/hooks/useListMutations.ts:186` | A queued (unsynced) write gets the same green success receipt as one that reached AniList, and the sidebar's queue depth does not move |
| A1-15 | P3 | DATA INTEGRITY RISK | DATA_INTEGRITY.md | `src-tauri/src/commands/list.rs:825` | The dedupe deletes the superseded queue row and inserts the new one as two statements; a failure in between loses the edit |
| A2-03 (=B3-06) | P3 | BUG | SCROBBLING_AUDIT.md | `src-tauri/src/playback/scrobbler.rs:1149-1158` | The five-minute episode-gap grace is bypassed for any source that reports a playback position |
| A2-06 | P3 | BUG / DATA INTEGRITY RISK | SCROBBLING_AUDIT.md | `src-tauri/src/playback/detection/jellyfin.rs:667` | Jellyfin season 0 (Specials) collapses into "no season", so a special matches the main entry and shares its correction row |
| A2-07 | P3 | BUG | SCROBBLING_AUDIT.md | `src-tauri/src/playback/scrobbler.rs:738-743` | `would_regress`'s own refusal is returned as an English sentence in a forceable `Failed` block |
| A2-08 | P3 | BUG | SCROBBLING_AUDIT.md | `src-tauri/src/lib.rs:258-266` | The tray "Scrobble now" item has no phase guard and turns a successful scrobble into a `Blocked(Failed)` |
| A2-10 | P3 | BUG | SCROBBLING_AUDIT.md | `src-tauri/src/db.rs:756-786` | `update_cached_progress` cannot insert, so a scrobble that *creates* a list entry leaves the cache at progress 0 |
| A2-14 | P3 | BUG | SCROBBLING_AUDIT.md | `src-tauri/src/playback/detection/jellyfin.rs:589,600-602` | A movie is detected and displayed but can never be scrobbled — no `IndexNumber`, so no session is ever created |
| A2-15 (=A1-18, =A3-15) | P3 | DATA INTEGRITY RISK | SCROBBLING_AUDIT.md | `src-tauri/src/playback/scrobbler.rs:755` | A save that was only *queued* is recorded as a completed scrobble — cache patched, `scrobble-done` emitted, phase `Updated` |
| A3-05 (=PERF-05) | P3 | PERFORMANCE PROBLEM | SYNC_AUDIT.md | `src-tauri/src/alerts/site.rs:124-146` | The site-notification pass stamps only on success, so a sustained failure degrades its 15–720 minute interval to one request per 60-second tick |
| A3-07 (=PERF-06) | P3 | BUG | SYNC_AUDIT.md | `src-tauri/src/playback/relations.rs:159-165` | The relations loader is the one outbound HTTP client in the tree with no timeout at any level |
| A3-11 | P3 | BUG | SYNC_AUDIT.md | `src/pages/Statistics.tsx:183,206` | Both list queries destructure `data` only, so a failed fetch renders empty charts as settled fact |
| A4-01 | P3 | BUG (concurrency) | DATABASE_AUDIT.md | `src-tauri/src/db.rs:551` | On Android two connections can race an `ALTER TABLE` because `has_column` is checked outside the transaction that acts on it |
| A4-03 | P3 | DATA INTEGRITY RISK | DATABASE_AUDIT.md | `src-tauri/src/library.rs:474` | A partially-readable library root produces a truncated walk that replaces the whole index, reported as a success |
| A4-04 | P3 | DATA INTEGRITY RISK | DATABASE_AUDIT.md | `src-tauri/src/library.rs:1364` | `MAX_FILES` truncation and `MAX_DEPTH` skipping are silent, and the truncated result overwrites the complete index |
| A4-20 (=PERF-15) | P3 | PERFORMANCE PROBLEM | DATABASE_AUDIT.md | `src-tauri/src/library.rs:933` | Four library-correction commands run a full index rewrite (and a reparse sweep) inline on the WebView UI thread |
| A4-21 (=B1-04 P4) | P3 | BUG | DATABASE_AUDIT.md | `src-tauri/src/commands/system.rs:283` | There is no reverse token migration: enable → disable → restart leaves the credential store empty and the user silently signed out |
| A4-22 | P3 | DATA INTEGRITY RISK | DATABASE_AUDIT.md | `src-tauri/src/lib.rs:356` | A database that fails to open aborts `setup`, so the app never starts and there is no in-app recovery path despite daily backups sitting beside the file |
| B1-01 (=C1-01 P2) | P3 | SECURITY RISK | SECURITY.md | `src-tauri/src/commands/images.rs:46` | The bio-image SSRF host guard misses IPv4-mapped and IPv4-compatible IPv6 literals and the `100.64/10` and `198.18/15` ranges |
| B1-02 | P3 | SECURITY RISK | SECURITY.md | `src-tauri/src/commands/images.rs:47` | A trailing dot defeats the name arm of the same guard: `http://printer.local./` is fetched |
| B1-03 | P3 | SECURITY RISK | SECURITY.md | `src-tauri/src/commands/images.rs:135` | The 4 MiB image cap is enforced only after the whole body has been buffered, so a chunked response is unbounded |
| B2-01 | P3 | DATA INTEGRITY RISK | UPDATE_AUDIT.md | `.github/workflows/release.yml:167-210` | Nothing checks that the version being published is greater than the one already published on the channel |
| B2-02 | P3 | BUG | UPDATE_AUDIT.md | `.github/workflows/release.yml:122-129` | A missing/absent AppImage entry degrades into every Linux user being shown a green "up to date" tick |
| B2-04 | P3 | BUG | UPDATE_AUDIT.md | `src-tauri/src/commands/update.rs:593-607` | The desktop download posts a bell row and an OS toast with no dedupe, one per day per ignored update |
| B2-05 | P3 | BUG | UPDATE_AUDIT.md | `src-tauri/src/commands/update.rs:548-591` | The updater plugin's HTTP client has no timeout at all, so a stalled download hangs the About page forever |
| B2-15 | P3 | BUG | UPDATE_AUDIT.md | `src-tauri/src/commands/update.rs:577-593` | The daily check re-downloads the whole ~100 MB installer for an update the user already declined |
| B2-16 | P3 | BUG | UPDATE_AUDIT.md | `src-tauri/src/commands/update.rs:128-143` | The 24 h throttle has no lower bound, so a backwards clock jump disables automatic checks indefinitely |
| B3-02 | P3 | DATA INTEGRITY RISK | DETECTION_AUDIT.md | `src-tauri/src/playback/detection/mod.rs:142` | The window-title rung sees no play state, so a paused or minimized player still matures the wall clock and writes progress |
| B3-03 | P3 | DATA INTEGRITY RISK | DETECTION_AUDIT.md | `src-tauri/src/commands/auth.rs:206` | `anilist_logout` leaves the `notifications` table and the alert dedupe keys behind, so account B sees A's bell rows and misses its own notifications |
| B3-04 | P3 | BUG | DETECTION_AUDIT.md | `src-tauri/src/playback/detection/mpv_ipc.rs:130` | The mpv IPC rung has no media-kind filter, so a music file outranks every other source |
| B3-07 | P3 | BUG | DETECTION_AUDIT.md | `src-tauri/src/playback/detection/jellyfin.rs:706` | Jellyfin session selection ignores `IsPaused` and takes the server's first match, so a stale paused session can suppress scrobbling entirely |
| B3-09 | P3 | ARCHITECTURAL PROBLEM | DETECTION_AUDIT.md | `src-tauri/src/playback/relations.rs:116` | The relations loader is an unsupervised one-shot, and `redirect` with zero rules silently passes the unredirected episode through |
| B4-03 | P3 | BUG | UI_UX_AUDIT.md | `src/api/social.ts:1458` | The bell's AniList notification rows carry no `isAdult`/`genres`, so the content filter cannot be applied to them at all |
| B4-06 | P3 | BUG | UI_UX_AUDIT.md | `src/pages/Calendar.tsx:348` | `blur_adult` is honoured on eight cover surfaces and silently skipped on five |
| B4-07 | P3 | BUG | UI_UX_AUDIT.md | `src/hooks/useGridRoving.ts:112` | The roving grid cursor never scrolls its card into view on Search and Seasonal |
| B4-09 | P3 | BUG | UI_UX_AUDIT.md | `src/pages/Dashboard.tsx:329` | "1 episodes across 1 shows air this week" — the one count string with no singular form |
| B4-16 (=PERF-17 P4) | P3 | BUG | UI_UX_AUDIT.md | `src/components/media/MediaCard.tsx:50` | The save handler mutates TanStack-owned query data in place, so no other observer of the page re-renders |
| PERF-04 | P3 | PERFORMANCE PROBLEM | PERFORMANCE.md | `src/pages/LocalLibrary.tsx:451-454` | The local-library screen renders every indexed title eagerly and unvirtualized |
| A1-07 | P4 | BUG | DATA_INTEGRITY.md | `src/hooks/useListMutations.ts:274` | A partial bulk failure recovers by refetching, which offline serves a cache the bulk edit never touched |
| A1-08 | P4 | BUG | DATA_INTEGRITY.md | `src/api/anilist.ts:227` | The local-mode bulk loop has no partial-progress contract, so one failure rolls the screen back over rows already written |
| A1-09 | P4 | BUG | DATA_INTEGRITY.md | `src-tauri/src/commands/list.rs:1024` | `enable_local_mode` leaves the viewer blob, so `SyncStatus.connected` is true in local mode and a stale identity keeps scoping the queue |
| A1-11 | P4 | BUG | DATA_INTEGRITY.md | `src-tauri/src/db.rs:324` | `MIGRATION_V16` calls `json_extract` on stored text without `json_valid`, which aborts startup on a malformed blob |
| A2-09 | P4 | DATA INTEGRITY RISK | SCROBBLING_AUDIT.md | `src-tauri/src/playback/scrobbler.rs:376-379` | `shift_episode` clamps an impossible mapping to episode 1 instead of refusing |
| A2-16 | P4 | BUG | SCROBBLING_AUDIT.md | `src-tauri/src/playback/scrobbler.rs:242-249,1143-1148` | The gap countdown keeps running on the card after the grace setting is switched off |
| A3-06 | P4 | BUG | SYNC_AUDIT.md | `src-tauri/src/anilist/client.rs:459-473` | `rate_snapshot` reports `remaining` without the window heal, so the panel can show a budget the limiter no longer believes |
| A3-09 (=PERF-07) | P4 | ARCHITECTURAL PROBLEM / DOCUMENTATION ISSUE | SYNC_AUDIT.md | `src/pages/Dashboard.tsx:374-379` | Four screens exceed the documented two-queries-per-mount cap and the Dashboard's own comment asserting compliance is false |
| A3-10 (=PERF-08) | P4 | PERFORMANCE PROBLEM | SYNC_AUDIT.md | `src/components/shell/Bell.tsx:321-328` | Opening the bell spends a count refetch whose answer the feed's page-1 reset discards on the success path |
| A3-16 (=PERF-09) | P4 | PERFORMANCE PROBLEM | SYNC_AUDIT.md | `src/hooks/useManualSync.ts:59-62` | The manual sync ends with a predicate invalidation that refetches every active non-list query, so a documented "three requests per click" is six or more |
| A4-05 | P4 | DATA INTEGRITY RISK | DATABASE_AUDIT.md | `src-tauri/src/db.rs:528` | No guard against a `user_version` ahead of the binary; an older build then writes `user_id IS NULL` queue rows the current build can never see |
| A4-06 | P4 | DATA INTEGRITY RISK | DATABASE_AUDIT.md | `src-tauri/src/library.rs:663` | `persist` publishes one scan as two independent transactions, so a failure between them shows a file as both matched and unplaced |
| A4-07 | P4 | DATA INTEGRITY RISK | DATABASE_AUDIT.md | `src-tauri/src/library.rs:1118` | An atomically-planned redirect change is applied as individual autocommitted deletes then inserts |
| A4-10 (=PERF-12) | P4 | PERFORMANCE PROBLEM | DATABASE_AUDIT.md | `src-tauri/src/commands/system.rs:600` | `set_backup_settings` runs a whole-database `VACUUM INTO` inline on the UI thread |
| A4-11 | P4 | BUG | DATABASE_AUDIT.md | `src-tauri/src/library.rs:1386` | Non-UTF-8 paths are stored lossily, producing a permanently dead play button with a misleading "rescan your library" message |
| A4-12 | P4 | BUG | DATABASE_AUDIT.md | `src-tauri/src/library.rs:327` | `set_library_path` is the one library-mutating command that does not consult the scan flag |
| A4-18 | P4 | BUG | DATABASE_AUDIT.md | `src-tauri/src/db.rs:155` | `library_unmatched`'s `(title, season, episode)` PK collapses duplicate unplaced files, so the group's count drops across a restart |
| A4-19 (=PERF-13) | P4 | PERFORMANCE PROBLEM | DATABASE_AUDIT.md | `src-tauri/src/library.rs:454` | `db.library_all().len()` materialises every row and its path just to get a count, under the `Db` mutex |
| A4-23 (DATABASE_AUDIT) | P4 | BUG | DATABASE_AUDIT.md | `src-tauri/src/commands/system.rs:272` | `enable_portable`'s documented failure guarantee is false for the token: it leaves the credential store before the marker is written |
| A4-24 (=PERF-16 P3) | P4 | PERFORMANCE PROBLEM | DATABASE_AUDIT.md | `src-tauri/src/library.rs:832` | `hydrate` re-parses every indexed path on the setup thread before the window exists |
| A4-25 (=PERF-20) | P4 | PERFORMANCE PROBLEM | DATABASE_AUDIT.md | `src-tauri/src/backups.rs:156` | `backups::run_once` is called directly inside the async loop, blocking a tokio worker for the duration of a `VACUUM INTO` |
| A4-26 | P4 | DATA INTEGRITY RISK | DATABASE_AUDIT.md | `src-tauri/src/library.rs:553` | The scan's two `kv_set` hints are separate autocommits after `persist`, so `library_files_seen` can describe the previous scan |
| A4-23 (LIBRARY_AUDIT) | P4 | BUG | LIBRARY_AUDIT.md | `src-tauri/src/library.rs:843-877` | `hydrate` re-derives splits from their rules but trusts the stored `media_id` over a `library_override`, so a failed `persist` leaves a correction that never appears |
| B1-05 | P4 | SECURITY RISK | SECURITY.md | `src-tauri/src/diagnostics.rs:96` | `redact_home` returns after the first match, so a log line naming two home paths keeps the user's name in the second |
| B1-07 | P4 | ARCHITECTURAL PROBLEM | SECURITY.md | `src-tauri/src/commands/playback.rs:211` | `set_mpv_ipc` stores an arbitrary executable path that `play_next` later spawns, escalating a WebView compromise to local code execution |
| B1-10 | P4 | SECURITY RISK | SECURITY.md | `src-tauri/src/commands/playback.rs:351` | `set_jellyfin_settings` takes an unvalidated URL over IPC and the 5 s detection poll then sends the stored Jellyfin token to it |
| B1-11 | P4 | SECURITY RISK | SECURITY.md | `src-tauri/src/library.rs:327` | `set_library_path` accepts an arbitrary path over IPC, unlike every other path-taking command, giving a scan-and-read-back enumeration primitive |
| B1-12 | P4 | SECURITY RISK | SECURITY.md | `src/lib/anilistMarkdown.ts:776` | The 24-image fan-out cap is per rendered document, not per screen, and `fetchBioImage` has no cache or concurrency limit |
| B2-03 | P4 | BUG | UPDATE_AUDIT.md | `src-tauri/src/commands/update.rs:169` | The throttle stamp is written before the status code and the body are validated, so a 5xx burns the day |
| B2-07 | P4 | BUG | UPDATE_AUDIT.md | `scripts/bump-version.mjs:94-113` | `writeAll`'s rollback restores every file except the one that threw, and does not name it as damaged |
| B2-08 | P4 | BUG | UPDATE_AUDIT.md | `scripts/release/release-notes.ps1:50-65` | The Linux paragraph is unconditional, so the notes describe an AppImage a degraded release does not carry |
| B2-09 | P4 | BUG | UPDATE_AUDIT.md | `.github/workflows/release.yml:366-374` | The rolling `latest` tag is force-moved before the release is published, not after |
| B2-17 | P4 | BUG | UPDATE_AUDIT.md | `src-tauri/gen/android/app/build.gradle.kts:34` | Android `versionCode`/`versionName` do not move on a commit-only bump, so two APKs are one version to the OS |
| B3-05 | P4 | SECURITY RISK (privacy) | DETECTION_AUDIT.md | `src-tauri/src/discord.rs:140` | The Discord presence's content-filter guard falls open for unmatched detections and broadcasts the raw parsed title |
| B3-08 | P4 | DATA INTEGRITY RISK | DETECTION_AUDIT.md | `src-tauri/src/playback/detection/jellyfin.rs:740` | `LAST_GOOD` survives a Jellyfin sign-out, so a failed first poll after a different sign-in can replay the previous account's playback |
| B3-10 | P4 | BUG | DETECTION_AUDIT.md | `src-tauri/src/alerts/airing.rs:262` | The non-truncated airing checkpoint shares its second with two strict bounds, potentially losing one notification per boundary |
| B3-11 | P4 | BUG (platform divergence) | DETECTION_AUDIT.md | `src-tauri/src/playback/detection/media_session/mod.rs:106` | SMTC's verbatim `"music"` label and MPRIS's inferred `"unknown"` reach different verdicts in `is_watchable` for the same browser session |
| B3-12 | P4 | BUG (observability) | DETECTION_AUDIT.md | `src-tauri/src/logging.rs:443` | A background loop that gives up after five panics, and a panicking detection sweep, have no user-visible signal beyond a log line |
| B3-13 | P4 | BUG | DETECTION_AUDIT.md | `src-tauri/src/discord.rs:38` | `RESEND_SECS` has no periodic caller, so a Discord restart mid-episode drops the presence until the next title or page change |
| B3-16 | P4 | BUG / CODE SMELL | DETECTION_AUDIT.md + LIBRARY_AUDIT.md | `src-tauri/src/playback/scrobbler.rs:847`, `src-tauri/src/library.rs:487` | The `Relations` `RwLock` is taken outside `sync::LockExt` at two sites, so one poisoned lock becomes a permanent outage |
| B3-20 | P4 | DATA INTEGRITY RISK | DETECTION_AUDIT.md | `src-tauri/src/alerts/stale.rs:136` | `stale_done:` is a third account-less dedupe key with the same logout lifetime problem as B3-03's |
| B3-21 | P4 | BUG | DETECTION_AUDIT.md | `src-tauri/src/playback/detection/jellyfin.rs:753` | `hold_last_good` replays a frozen position for up to three ticks, feeding the scrobbler a stale verdict rather than no verdict |
| B4-04 | P4 | BUG | UI_UX_AUDIT.md | `src/components/shell/Bell.tsx:430` | Stored Karasu notification rows are filtered at write time only and are never re-checked at render |
| B4-05 | P4 | BUG | UI_UX_AUDIT.md | `src/components/overlays/MatchPicker.tsx:113` | The match picker and season-split search omit the `isAdult` server argument and trim the page on arrival instead |
| B4-08 | P4 | BUG | UI_UX_AUDIT.md | `src/pages/settings/AdvancedPane.tsx:838` | Four settings controls paint optimistically with no rollback and no error surface |
| C1-21 | P4 | BUG | TEST_GAPS.md | `src-tauri/src/commands/system.rs:689` | The only test that temp-writes to a fixed shared path also `remove_dir_all`s it first, so two concurrent runs delete each other's directory |

**Severity disagreements between reports.** Six defects were rated differently by
two passes. The row keeps the home report's severity; the higher figure is worth
knowing when triaging:

- **A3-01** — P1 in `ACCOUNT_ISOLATION.md`, P2 as B4-01 in `UI_UX_AUDIT.md`.
  The isolation pass had the wider evidence (ten viewer-blind cache keys, not six).
- **A2-02** — P2 in `SCROBBLING_AUDIT.md`, P3 as B3-18 in `DETECTION_AUDIT.md`.
- **B1-01/B1-02** — P3 each in `SECURITY.md`, P2 as the single C1-01 in
  `TEST_GAPS.md`, which weighted the *untested* 13 host spellings.
- **A4-21** — P3 in `DATABASE_AUDIT.md`, P4 as B1-04 in `SECURITY.md`.
- **A1-05** — P3 in `DATA_INTEGRITY.md`, P4 as A4-08 in `DATABASE_AUDIT.md`.
- **A4-24** — P4 in `DATABASE_AUDIT.md`, P3 as PERF-16 in `PERFORMANCE.md`
  (and as `LIBRARY_AUDIT.md`'s A4-21).
- **B4-16** — P3 in `UI_UX_AUDIT.md`, P4 as PERF-17 in `PERFORMANCE.md`; the two
  reports were filing the correctness face and the render-economy face of one line.

## Clusters

Eleven root causes account for 79 of the 103 defects. A cluster is not a theme —
each one below is a single change that closes the whole group, and the group is
listed so the maintainer can see what the change is worth.

### 1. `list_cache` is a second copy of the list that only one writer keeps current

**A1-03 (P2), A1-14 (P2), A1-05 (P3), A2-10 (P3), A1-17 (P3), A3-14 (P2), A2-15 (P3).**

`list_cache` is written by `fetch_media_list` and patched by
`update_cached_progress`, and by nothing else. Every other path that changes an
entry — a manual save, a bulk edit, a delete, a queue drain — leaves it stale.
The scrobbler then reads it as truth: A1-03 is its two anti-regression guards
consulting a cache no save updates, A1-14 is a deleted entry the cache
resurrects on the next play, A2-10 is a created entry the cache still calls
progress 0, A1-05 is a concurrent full write silently discarding the patch, and
A2-15 patches it from a save that never left the machine. A1-17 is the same
table with no purge across an identity change, and A3-14 is the mirror image:
the one moment the cache is genuinely useful — a 429 or a rejected token — is
the moment nothing consults it.

**The change:** one `db` seam that owns the table — `upsert_entry`,
`delete_entry`, `replace_list`, `clear_for_user` — taken under a single lock,
called by *every* write path including the drain, and consulted by the offline
fallback on any error that is not a definitive rejection. Nothing else touches
`list_cache` directly. That is one function set and it retires seven findings,
two of them P2.

### 2. A result flag the callers throw away

**A2-15 (=A1-18, =A3-15) (P3), A1-02 (P2), A1-06 (=A3-08) (P3), A1-07 (P4), A1-08 (P4).**

`MutationResult` carries `queued`, and `process_queue` distinguishes a drain that
ran from one that was skipped. Both facts are then dropped. `perform_update`
ignores `queued` and sets `Phase::Updated`, patches the cache and emits
`scrobble-done` for a write that is still sitting in SQLite (A2-15).
`delete_list_entry` reads a *skipped* drain as a successful one and deletes
live, so a queued save recreates the row it just deleted (A1-02). The frontend
shows the same green receipt for a queued save as for a landed one and leaves
the queue-depth badge unmoved (A1-06). The bulk paths have the same shape from
the other end: no partial-progress contract, so a failure halfway rolls the
screen back over rows that were written (A1-07, A1-08).

**The change:** make "queued" and "skipped" unrepresentable as success. Return a
three-state outcome (`Landed` / `Queued` / `Skipped`) instead of a struct with a
boolean nobody must forget, and give `Queued` no path to a success receipt, a
`Phase::Updated`, or a cache patch. The compiler then finds the five call sites.
CLAUDE.md's own `receiptText` convention already establishes the shape.

### 3. Identity lives in several stores and is cleared in some of them

**A3-01 (P1), A1-01 (P2), A1-16 (P3), A1-17 (P3), B3-03 (P3), A1-09 (P4), B3-08 (P4), B3-20 (P4).**

There is no single "this is now a different account" operation. The token, the
cached viewer blob, `profile_mode`, the TanStack query cache, `list_cache`, the
`notifications` table, the three alert dedupe keys and Jellyfin's `LAST_GOOD`
are eight stores updated by four different code paths, and each transition
touches a different subset. `connect_with_token` performs three unwound writes
in the unsafe order (A1-01, A1-16). `anilist_logout` clears three of the eight
(A1-17, B3-03, B3-20). `enable_local_mode` clears one (A1-09). The frontend
clears none, which is the P1: ten viewer-blind cache keys keep serving account
A's entry — private notes included — under account B, inside the 5-minute
`staleTime`, where one Save writes it to B's list (A3-01). B3-08 is the same
shape one layer down, on a *Jellyfin* sign-out.

**The change:** one `switch_identity(next: Identity)` in Rust, transactional, that
is the only way any of the eight stores changes hands — token, viewer, mode and
every account-scoped table in one `db` transaction, dedupe keys and `LAST_GOOD`
reset, one event emitted. The frontend's listener answers it with
`queryClient.clear()`. Sign-in, sign-out and local mode all call it with a
different argument, which is what makes "cleared in some of them" impossible
rather than merely fixed.

### 4. Play state and settings never reach the tick that decides

**B3-01 (P1), B3-02 (P3), B3-07 (P3), A2-02 (P2), A2-03 (P3), B3-21 (P4), A2-08 (P3), A2-16 (P4).**

`drive_session` runs every 5 s, and the things it must know arrive only at
session creation or not at all. `settings.enabled` is read when the session is
built and never again, so switching automatic scrobbling off mid-episode still
writes (A2-02). The window-title rung reports no play state, so a paused player
matures the wall clock (B3-02); Jellyfin's `IsPaused` is not consulted at all
(B3-07); `hold_last_good` invents a verdict for up to three ticks rather than
reporting none (B3-21). And the absence of a verdict is treated as the end of the
session rather than as an absence, so one empty tick — an ordinary pause on a
media-session-only player — destroys the session and the whole threshold with it
(B3-01, the P1). A2-03 and A2-16 are the gap grace being decided by a stale
input in the same loop; A2-08 is the tray forcing a write with no phase guard.

**The change:** two things, both in `drive_session`. Give the detection verdict an
explicit `Playing | Paused | Unknown` (with "nothing detected" as a fourth,
distinct from "session over"), and read the settings snapshot at the top of every
tick rather than closing over it at creation. Then a pause holds the session, a
paused source cannot mature a clock, a toggle disarms the running session, and
`hold_last_good` can honestly report `Unknown`.

### 5. A multi-statement publish with no transaction around it

**A4-06 (P4), A4-07 (P4), A4-26 (P4), A1-15 (P3), A4-23-LIBRARY (P4), A4-02 (P2).**

CLAUDE.md already states the rule for migrations — go through `apply`, which
wraps the step so the change and its `user_version` land together. Every *other*
multi-statement write in the tree ignores it. `persist` publishes one scan as two
transactions (A4-06); a planned redirect change is a run of loose autocommitted
deletes then inserts (A4-07); the scan's two `kv` hints autocommit after the
index they describe (A4-26); the queue dedupe is a delete and an insert with a
window between them where the edit exists nowhere (A1-15). A4-23-LIBRARY is the
observable consequence: `set_library_match` commits the override and then fails
`persist`, so the correction is on record and the index still disagrees, across
every restart. A4-02 is the extreme case — the *destination* changes mid-session,
so a whole session's writes land in a file the next launch will not open.

**The change:** a `Db::with_txn` helper and a rule that any command writing more
than one row uses it, `persist` and `plan_redirect` first. A4-02 additionally
needs `enable_portable` to defer the path switch to the next launch, which is
where the marker takes effect anyway.

### 6. URL and path validation by spelling instead of by parsing

**B1-01 (P3), B1-02 (P3), B1-03 (P3), B1-10 (P4), B1-11 (P4), B1-07 (P4), B1-12 (P4).**

`host_is_local` decides by matching strings, so three spellings of loopback that
no test covers walk through it (B1-01, B1-02), and the size cap is applied after
the body is already in memory (B1-03). The same absence one layer out: three IPC
commands accept a URL or a path with no validation at all — the Jellyfin base URL
the poll then sends a token to (B1-10), the library root (B1-11), and an
executable path `play_next` later spawns (B1-07). B1-12 is the missing bound on
the same fetch path.

**The change:** one validation seam beside `net.rs`, which CLAUDE.md already names
as the single place every outbound client is born. It canonicalises a host to an
`IpAddr` (mapped and compatible IPv6 forms resolved, trailing dot stripped) before
any range test, enforces the cap while streaming rather than after buffering, and
is the only way an IPC-supplied URL or path reaches a client or a `Command`. The
existing 13-spelling test grows the three cases it misses.

### 7. Rate-limiter state that is written but never read

**A3-02 (P2), A3-03 (P2), A3-04 (P2), A3-06 (P4), A3-05 (P3), A3-16 (P4), A3-10 (P4), A3-09 (P4).**

The ~30/min budget is a hard constraint in CLAUDE.md and the code that enforces it
is not joined up. `park` records `sleeping_until` from a server `Retry-After` and
nothing that decides whether to send ever reads it, while the window heal repairs
the budget straight through the deadline (A3-02); `rate_snapshot` reports a
number the limiter itself no longer believes (A3-06). Above it, a frontend retry
stacks on the Rust retry with no cancellation, so one read costs four requests
(A3-03). Around it, spenders nobody metered: a failing site pass degrades to one
request per minute (A3-05), a manual sync invalidates far more than it claims
(A3-16), opening the bell buys an answer that is then discarded (A3-10), and four
screens exceed the documented two-queries-per-mount cap while a comment asserts
they do not (A3-09). A3-04 is the coupling that makes all of it visible to the
user: the write is awaited inside the 5 s detection loop, so a throttled save
freezes detection.

**The change:** one pre-flight gate every send passes through, reading the budget
*and* `sleeping_until` in the same decision, plus one retry layer instead of two.
Then decouple the scrobbler's write from the poll — spawn it and let the next tick
observe the phase — which is the single highest-value line in this cluster because
it converts a rate-limit problem into a background one.

### 8. Failure reported as success

**A4-03 (P3), A4-04 (P3), B2-02 (P3), A4-11 (P4), A3-11 (P3), B4-08 (P4), B3-12 (P4).**

A partially-readable library root produces a truncated walk that replaces the
complete index behind a success toast (A4-03); `MAX_FILES` and `MAX_DEPTH` do the
same silently (A4-04); a non-UTF-8 path is stored lossily and becomes a dead play
button whose message tells the user to rescan (A4-11). The updater's version is
the release-pipeline face: a missing AppImage entry degrades into a green "up to
date" tick for every Linux user (B2-02). On screen, a failed statistics fetch
renders empty charts as settled fact (A3-11), four settings controls paint
optimistically with no rollback (B4-08), and a background loop that has given up
after five panics says nothing at all (B3-12).

**The change:** make the partial outcome a value rather than an absence. A scan
returns `{ indexed, skipped, truncated }` and the toast renders `skipped`; the
manifest job fails rather than publishing a platform-less entry; a query's
`isError` is destructured wherever its `data` is. The rule to hold is that no
function may return `Ok(())` when it knows it did less than it was asked to.

### 9. Blocking work on a thread that must not block

**A4-20 (P3), A4-24 (P4), A4-10 (P4), A4-25 (P4), A4-19 (P4), PERF-04 (P3).**

Four library-correction commands and `set_backup_settings` are plain
`#[tauri::command]`s — `ExecutionContext::Blocking` by the rule `library.rs`
itself states — and each ends in a whole-index rewrite or a `VACUUM INTO` on the
WebView UI thread (A4-20, A4-10). `hydrate` re-parses every indexed path inside
`setup`, before the window exists (A4-24). `backups::run_once` blocks a tokio
worker from inside an async loop (A4-25). A row count materialises every path
string under the `Db` mutex (A4-19). PERF-04 is the frontend's own version:
the local-library screen renders every indexed title unvirtualized, in an app
whose other lists are virtualized on purpose.

**The change:** `async` commands plus `spawn_blocking` for anything that takes the
`Db` mutex or walks the filesystem, `hydrate` moved off the setup path onto a task
the window can wait on, and `SELECT COUNT(*)` where a count is wanted. PERF-04 is
separate work and reuses `VirtualGrid`.

### 10. The content filter applied where the data is fetched, not where it is drawn

**B4-03 (P3), B4-06 (P3), B4-04 (P4), B4-05 (P4), B3-05 (P4).**

CLAUDE.md puts the rule in exactly one module and calls `FilteredNotice` the one
disclosure line, and the *rule* is right. The application sites are not. The
bell's AniList rows are queried without `isAdult`/`genres`, so the filter cannot
run on them at all (B4-03); stored Karasu rows are filtered once at write time and
never re-checked, so changing the setting does not change them (B4-04); five of
thirteen cover surfaces ignore `blur_adult` (B4-06); the match picker omits the
server-side `isAdult` argument and trims the page after it arrives (B4-05). B3-05
is the same guard falling *open* on the way out: an unmatched detection is
broadcast to Discord as the raw parsed title.

**The change:** carry `isAdult` and `genres` on every query that feeds a cover or
a title, and move the gate into the shared cover/title component so it runs at
render. A guard that must be remembered at 21 call sites is a guard that will be
forgotten at some of them — TEST_GAPS' C1-08 says 20 of the 21 are untested.

### 11. Version arithmetic spread across files nothing compares

**B2-01 (P3), B2-16 (P3), B2-03 (P4), B2-17 (P4), B2-07 (P4), B2-09 (P4), B2-08 (P4).**

The four-part version lives in five places and CLAUDE.md documents the `+`
build-metadata spelling and the comparator that make the updater work at all —
correctly, and at length, because it has already gone wrong. What is missing is
anything that *checks*. Nothing asserts the published version is greater than the
one already on the channel (B2-01); Android's `versionCode` does not move on a
commit-only bump, so two APKs are one version to the OS (B2-17); the rolling tag
moves before the release exists (B2-09); the notes describe an artifact a degraded
release may not carry (B2-08); `writeAll`'s rollback restores every file except
the damaged one (B2-07). B2-03 and B2-16 are the client half — a throttle stamped
before the response is validated, and with no lower bound against a backwards
clock.

**The change:** a pre-publish assertion in the release workflow that the new
version sorts strictly above the channel's current `latest.json`, and one script
that derives every version field — the three manifests, `COMMIT_NUMBER`,
`versionCode`, `versionName` — from a single source, so a bump cannot move four
of six. TEST_GAPS' B2-06 and C1-07 are the tests that would have caught this
group and are worth doing with it.

### Findings outside every cluster

Twenty-four defects have no shared cause and need individual fixes. The ones
worth naming: **C1-02 (P1)** and **C1-18 (P2)**, the shared panic hook that makes
`npm run verify` intermittently red — the gate itself, and therefore first;
**A2-04 (P2)**, the season-stripped variant in the exact-match short circuit,
which is a matcher correctness bug that writes to a list; **A2-01 (P2)**, the
correction dialog measuring an offset against the already-shifted episode; and
**A4-22 (P3)**, a database that fails to open bricking an app whose only
documented restore path runs through that app.

## Counts

| Severity | In this register |
|---|---:|
| P0 | 0 |
| P1 | 3 |
| P2 | 13 |
| P3 | 41 |
| P4 | 46 |
| **Total functional defects** | **103** |

| | Count |
|---|---:|
| Distinct findings across the whole audit | **182** |
| Indexed here (BUG / DATA INTEGRITY RISK / SECURITY RISK / ARCHITECTURAL PROBLEM / PERFORMANCE PROBLEM) | 103 |
| Excluded by category (IMPROVEMENT 20, DOCUMENTATION ISSUE 22, MISSING TEST 21, CODE SMELL 8, INVESTIGATION 4, DEAD CODE 1, RELEASE HYGIENE 1, PROCESS 1) | 79 |
| Findings filed under more than one id across reports | 56 |
| Refuted during verification (distinct: A1-13, B1-08, B4-14, C1-17) | 4 |

The 238 entries in the fourteen reports' own tables reduce to 182 distinct
findings: `PERFORMANCE.md`, `LIBRARY_AUDIT.md` and `ACCOUNT_ISOLATION.md` are
cross-cutting views that re-file findings owned elsewhere, and one defect
(`A2-15` / `A1-18` / `A3-15`, a queued save recorded as a completed scrobble) was
found independently by three passes.
