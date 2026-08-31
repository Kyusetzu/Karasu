# Test Coverage and Gaps

## Scope

This report covers the test suites themselves: what they prove, what they only
appear to prove, and which shipped behaviour has no guard at all. The question
asked was not "are there tests" but "would these tests catch a real regression".
Where that could be settled by experiment rather than by reading it was: the
parallel-run failure was reproduced and isolated, the matcher equivalence test
was mutation-tested in a standalone harness built from copies of the repo's own
sources, and the SSRF guard was compiled standalone against the repo's own `url`
rlib and driven with the address spellings in question.

Audited read-only at working-tree `3381dec`; verification re-ran at `9a53427`,
whose diff against `3381dec` touches nothing under `src/` or `src-tauri/`. No
repository file outside this report was modified.

### Baseline, as measured in this audit

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | clean, exit 0 |
| Frontend | `npx vitest run` | 86 files, 935 tests, **all passing**, 14.43 s |
| Rust, serial | `cargo test --lib -- --test-threads=1` | **303 passed**, 1 ignored, 2.37 s |
| Rust, default parallelism — what the gate runs | `cargo test --manifest-path src-tauri/Cargo.toml` | **intermittently FAILS** |

The parallel Rust run is the one fact in that table that matters most, because it
is the run `npm run verify` performs and therefore the run both CI jobs and the
release workflow perform. It is not deterministic: the audit pass measured 3
failures in 3 runs, the verification pass 2 in 3, and a third re-run for this
report 1 in 3. The failing test is always
`logging::tests::the_panic_hook_records_the_panic`, and the entry it finds is
always the one `sync::tests::a_poisoned_lock_still_hands_over_its_data` wrote
into the same process-global ring. That is C1-02, and it is the only P1 here.

Re-measurements taken for this report on the same tree: vitest 17.02 s (86 files,
935 tests, green), serial Rust 2.08 s (303 passed, 1 ignored). The wall-clock
differences are machine load; the counts are identical.

### Where the tests live

* **Frontend, 86 files.** 65 of them are in `src/lib` — the pure-logic layer the
  repo's own convention pushes work into, and it is well served. Outside it: 3
  of 24 hooks, 1 of 7 stores, 1 page, 15 component files, and **zero** across
  `src/api`'s seven files (4,234 lines).
* **Rust, 303 tests.** Concentrated in `db.rs` (33), `jellyfin.rs` (28),
  `media_session/mod.rs` (23), `client.rs` (20), `logging.rs` (19),
  `library.rs` (19), `parser.rs` (18) and `scrobbler.rs` (17).

The gaps below are not randomly distributed. They follow one shape, and it is the
one the repo's "extract pure logic and unit test it" convention predicts: **the
pieces are tested and the compositions are not.** `queue_key` is tested and
`process_queue` is not (C1-04); `shift_episode` and `block_reason` are tested and
`build_now_playing`/`requeue_match` are not (C1-05); `inverse` is tested and the
cache patch it accompanies is not (C1-06); `isBlocked` is tested and 20 of its 21
call sites are not (C1-08); the update manifest's *reader* is tested and its
*writer* is not (C1-07).

## Findings at a glance

| ID | Severity | Category | File:Line | Summary |
|---|---|---|---|---|
| C1-02 | P1 | BUG | `src-tauri/src/logging.rs:745` | The one verify gate fails intermittently because two tests share a global panic hook and ring while only one takes the serialising lock |
| C1-01 | P2 | SECURITY RISK | `src-tauri/src/commands/images.rs:46` | The bio-image SSRF guard accepts `::ffff:127.0.0.1`, `::127.0.0.1` and `localhost.`; none of its 13 tested spellings covers those forms |
| C1-04 | P2 | MISSING TEST | `src-tauri/src/commands/list.rs:897` | `process_queue` — the offline-queue drain, whose failure modes are "the edit is discarded" and "the queue never drains again" — has no test at all |
| C1-05 | P2 | MISSING TEST | `src-tauri/src/playback/scrobbler.rs:426` | `build_now_playing` and `requeue_match` decide which entry and which episode a scrobble writes; neither is tested, and the ordering rule is duplicated 350 lines apart |
| C1-06 | P2 | MISSING TEST | `src/hooks/useListMutations.ts:86` | The optimistic cache patch and the partial-vs-total rollback split are untested, including the `??`-not-`||` guard that keeps `private: false` real |
| C1-18 | P2 | BUG | `src-tauri/src/logging.rs:683` | `the_ring_is_bounded_and_newest_first` has C1-02's race too, and C1-02's recommended fix does not cover it |
| C1-03 | P3 | MISSING TEST | `src-tauri/src/playback/recognition/matcher.rs:286` | The equivalence test shares every scoring primitive with the code it checks, so deleting the `"Show 2"` season spelling is invisible repo-wide |
| C1-07 | P3 | MISSING TEST | `scripts/release/generate-update-manifest.ps1:68` | The `+` build-metadata spelling is pinned on the reader side and nowhere on the writer side; nothing asserts the three manifests agree |
| C1-08 | P3 | MISSING TEST | `src/lib/contentFilter.ts` (21 call sites) | The content-filter rule is thoroughly tested; 20 of its 21 application sites are not, including Search and CommandPalette's in-loop filter |
| C1-10 | P3 | MISSING TEST | `src-tauri/src/db.rs:1771` | The half-migrated-reopen test asserts only `user_version`, never a row, so it cannot tell a correct guard from a skipped v16 backfill |
| C1-12 | P3 | MISSING TEST | `src-tauri/src/commands/playback.rs:70` | Nothing asserts `MEDIA_DETECTION_KEY == "smtc_enabled"` or the fresh-install scrobble defaults, though both readers are already test-shaped |
| C1-13 | P3 | MISSING TEST | `src/api/franchise.ts:147` | The app's only BFS — bounded by a hard constraint — is untested, along with its truncation flag, hub dedupe and filtered-node drop |
| C1-14 | P3 | MISSING TEST | `src/stores/theme.ts:174` | The one-shot cover-columns migration deletes the old key before writing the new one, and neither the map, the delete nor the platform default is asserted |
| C1-15 | P3 | MISSING TEST | `src/hooks/useColumnCount.ts:63` | The `watch` dependency CLAUDE.md calls load-bearing can be deleted with the whole suite staying green |
| C1-19 | P3 | MISSING TEST | `src/api/anilist.ts:51` | `isTokenRejected` is a deliberately exact match with the reason in its comment; loosening it to `.includes` signs users out on their own note text, untested |
| C1-20 | P3 | MISSING TEST | `src/api/anilist.ts:243` | `bulkSaveEntries`' `?? null` chain is the same `??`-vs-`||` trap as C1-06 on the payload half, and equally untested |
| C1-09 | P4 | MISSING TEST | `src-tauri/src/anilist/auth.rs:390` | The Windows DPAPI test module has one of the Linux module's four cases; `save_token_file`/`load_token_file` are untested on either platform |
| C1-11 | P4 | MISSING TEST | `vitest.setup.ts:13` | Neither i18n guard looks at `{{…}}`, so an interpolation-variable mismatch would render literally; measured clean today across 1,191 shared leaves |
| C1-16 | P4 | DEAD CODE | `src-tauri/src/playback/detection/mod.rs:124` | The one `#[ignore]`d test prints an empty result on Linux, where the enumerator it exercises is a stub, and says so nowhere |
| C1-21 | P4 | BUG | `src-tauri/src/commands/system.rs:689` | The only test that temp-writes to a fixed shared path also `remove_dir_all`s it first, so two concurrent runs delete each other's directory |

---

ID: C1-02

Severity: P1

Category: BUG

File: /home/user/Karasu/src-tauri/src/logging.rs

Line: 745–770 (the test); interacts with /home/user/Karasu/src-tauri/src/sync.rs:49

Function: `logging::tests::the_panic_hook_records_the_panic`

Problem:
`npm run verify` is the whole gate — `npm run typecheck && npm test && cargo test
--manifest-path src-tauri/Cargo.toml` (package.json:12). Both CI jobs run it
(`.github/workflows/ci.yml:46` on windows-latest, `:114` on ubuntu) and so does
the release workflow (`release.yml:78`, `:254`). That final `cargo test` runs at
default parallelism, and under default parallelism
`logging::tests::the_panic_hook_records_the_panic` fails intermittently.

Expected Behavior:
The test finds the entry its own `catch_unwind` produced.

Actual Behavior:
It finds `sync.rs`'s. The failure is the assertion at logging.rs:762 printing the
entry it found:

```
thread 'logging::tests::the_panic_hook_records_the_panic' panicked at src/logging.rs:762:9:
[unnamed] while holding the lock (src/sync.rs:49)
```

Mechanism, read off the source. The test calls `install_panic_hook()`
(logging.rs:751), which sets a **process-global** hook that writes every panic
into the **process-global** ring with target `"panic"` (logging.rs:478–503).
`entries()` returns newest-first, and the test's predicate is
`.find(|e| e.target == "panic")` — the *newest* panic entry, not its own.
`sync::tests::a_poisoned_lock_still_hands_over_its_data` deliberately panics a
spawned thread (`panic!("while holding the lock")`, sync.rs:49) to poison a
mutex; that panic runs through the same installed hook into the same ring. The
`serialize()` lock the logging tests take does not help — `sync.rs`'s test does
not take it and has no reason to.

Reproduction:
```
$ cd /home/user/Karasu/src-tauri
$ cargo test --lib -- --test-threads=1
test result: ok. 303 passed; 0 failed; 1 ignored          (2.08 s)
$ cargo test --lib                     # x3, this report
run 1: ok.     303 passed
run 2: FAILED. 302 passed; 1 failed
run 3: ok.     303 passed
$ cargo test --lib logging             # sync filtered out
test result: ok. 19 passed; 0 failed
$ cargo test --lib -- --skip sync::    # everything except sync
test result: ok. 302 passed; 0 failed; 1 ignored
```
Removing `sync::` from the run is sufficient and necessary to make the parallel
run green. Across the three passes made during this audit the failure rate was
3/3, then 2/3, then 1/3.

Impact:
The one gate the repo has fails on a schedule nobody controls. A deterministic
failure would be better; a flaky one is the worse shape, because a gate that is
green by scheduling luck teaches people to re-run rather than to read. Either
way `npm run verify` cannot be trusted to mean what CLAUDE.md says it means, and
the standing instruction "run it bare and read the exit code" is undermined by a
failure that has nothing to do with the change under test. It also blocks a
release: `release.yml` runs the same gate twice.

Root Cause:
The test identifies its own entry by `target == "panic"` alone, a predicate that
is not unique in a binary where another test panics through the same global hook.
Two process-global resources are involved — the panic hook and the ring — and
only one participant takes the serialising lock.

Recommended Fix:
Make the predicate identify the entry rather than its class:
`.find(|e| e.target == "panic" && e.message.contains("a deliberate test panic"))`.
One line, no coordination with `sync.rs`. Do **not** fix it by serialising
`sync.rs`'s test into `GLOBAL_LOG_STATE` — that couples an unrelated module to
the logger's test lock and only narrows the window, since the hook stays installed
for the rest of the binary. Note that this fix does not cover C1-18; see there.

Regression Tests Required:
After the fix, add `a_second_panic_from_elsewhere_does_not_take_the_entry` in
`src-tauri/src/logging.rs`: install the hook, `catch_unwind` a panic carrying a
unique marker, `catch_unwind` a second panic with a different marker, then assert
the first marker is still findable. That pins the identifying predicate rather
than the ordering, so the fix cannot regress back to "newest wins".

Confidence: HIGH — reproduced independently in both the audit and the
verification pass, with the mechanism read off the source and isolated by
`--skip sync::`.

---

ID: C1-01

Severity: P2

Category: SECURITY RISK

File: /home/user/Karasu/src-tauri/src/commands/images.rs

Line: 46–70 (`host_is_local`, `url_is_fetchable`); test at 161–183

Function: `host_is_local`

Problem:
`host_is_local` is the SSRF guard on `fetch_bio_image`, which fetches an image
whose URL comes out of another AniList user's bio. Its own doc comment states the
property it exists for: a crafted profile must not be able to make the app probe
the machine it runs on or the LAN behind it. It matches loopback, private and
link-local IPv4 and `::1`, `fc00::/7`, `fe80::/10` for IPv6 — and misses the
**IPv4-mapped IPv6** form (`::ffff:127.0.0.1`), the **IPv4-compatible** form
(`::127.0.0.1`), and a **fully-qualified `localhost.`** with a trailing dot.
`local_and_private_hosts_are_refused` (images.rs:161–183) tests thirteen host
spellings and none of them is one of these three.

Expected Behavior:
`url_is_fetchable("http://[::ffff:127.0.0.1]/a.png")` is `false`, as it already
is for `http://127.0.0.1/a.png` and `http://[::1]/a.png`.

Actual Behavior:
It is `true`. Verified twice independently, by compiling `host_is_local` and
`url_is_fetchable` verbatim against the repo's own `url` rlib
(`target/debug/deps/liburl-*.rlib`) and running the spellings through them:

```
http://[::ffff:127.0.0.1]/a.png        host=[::ffff:7f00:1]     fetchable=true
http://[::ffff:169.254.169.254]/meta   host=[::ffff:a9fe:a9fe]  fetchable=true
http://[::ffff:10.0.0.5]/a.png         host=[::ffff:a00:5]      fetchable=true
http://[::ffff:192.168.0.1]/a.png      host=[::ffff:c0a8:1]     fetchable=true
http://[0:0:0:0:0:ffff:7f00:1]/a.png   host=[::ffff:7f00:1]     fetchable=true
http://[::127.0.0.1]/a.png             host=[::7f00:1]          fetchable=true
http://localhost./a.png                host=localhost.          fetchable=true
http://2130706433/a.png                host=127.0.0.1           fetchable=false   <- correct
http://0x7f000001/a.png                host=127.0.0.1           fetchable=false   <- correct
http://127.0.0.1/a.png                 host=127.0.0.1           fetchable=false
http://[::1]/a.png                     host=[::1]               fetchable=false
```

The decimal and hex spellings are **not** a hole: the `url` crate's WHATWG host
parser normalises `2130706433` and `0x7f000001` to `127.0.0.1` before the guard
sees them. Only the IPv6 spellings and the trailing dot get through.

The cause is exact and provable from `std`: for `::ffff:127.0.0.1`,
`Ipv6Addr::is_loopback()` is false (it matches only `::1`), `is_unspecified()` is
false, and `segments()[0]` is `0x0000`, so neither `& 0xfe00 == 0xfc00` nor
`& 0xffc0 == 0xfe80` holds. For `localhost.` the string is neither equal to
`"localhost"` nor a suffix match for `".localhost"` or `".local"`.

Reproduction:
1. View any AniList profile whose bio contains
   `img(http://[::ffff:127.0.0.1:8080]/x.png)` or `img(http://localhost./x.png)`.
   `RichText.tsx:103–107` fetches every bio image on render, so no user action
   beyond opening the profile is needed.
2. `fetch_bio_image` passes `url_is_fetchable`, builds the client and issues the
   GET. The redirect policy re-checks with the same broken predicate, so a public
   host may also redirect to `[::ffff:127.0.0.1]` and be followed.

Impact:
Blind SSRF from third-party content into loopback, RFC1918 and link-local space,
including `169.254.169.254`. The response never returns to the bio's author — it
becomes a `data:` URI in the victim's own WebView, only for five allow-listed
image MIME types under 4 MB — so this is not an exfiltration channel. What it
does defeat is exactly the property the function documents, from untrusted input.

Verification: downgraded from P1 — the module's own doc comment (images.rs:38–43)
already accepts the strictly larger hole that a *hostname resolving* to a private
address gets through, since closing that needs a custom DNS resolver; an attacker
who can write a bio can therefore reach `127.0.0.1` today with an ordinary A
record and no bypass at all, so closing `::ffff:` and `localhost.` restores
internal consistency rather than removing a capability. The OS half was also not
proven end to end by either pass — only the predicate was — and on Windows
`IPV6_V6ONLY` defaults on for a fresh `AF_INET6` socket, so the mapped form may
not even connect on the maintainer's own platform.

Root Cause:
The IPv6 arm enumerates three prefixes and never canonicalises an IPv4-mapped or
IPv4-compatible address down to its embedded V4 before applying the V4 rules; the
hostname arm does not strip a trailing root dot. No test exercises either shape,
so the omission has never been visible.

Recommended Fix:
In `host_is_local`, strip one trailing `.` from `h` before the name comparisons,
and in the `IpAddr::V6` arm map the address to IPv4 first
(`v6.to_ipv4_mapped().or_else(|| v6.to_ipv4())`); when that yields a V4, apply
the existing V4 predicate to it. Keep the existing V6 prefix checks for the
non-mapped case.

Regression Tests Required:
Extend `local_and_private_hosts_are_refused` in
`src-tauri/src/commands/images.rs` with `http://[::ffff:127.0.0.1]/a.png`,
`http://[::ffff:169.254.169.254]/meta`, `http://[::ffff:10.0.0.5]/a.png`,
`http://[0:0:0:0:0:ffff:7f00:1]/a.png`, `http://[::127.0.0.1]/a.png` and
`http://localhost./a.png`. Add `a_public_address_in_mapped_form_is_still_allowed`
asserting `http://[::ffff:93.184.216.34]/a.png` stays fetchable, so the fix is a
canonicalisation and not a blanket ban on the `::ffff:` prefix. Add
`decimal_and_hex_host_spellings_normalise_before_the_guard` pinning that
`http://2130706433/a.png` is refused — correct today by the URL parser's
behaviour, which is a dependency's property and therefore worth pinning.

Confidence: HIGH — the predicate's behaviour was reproduced twice from compiled
code, not inferred.

---

ID: C1-04

Severity: P2

Category: MISSING TEST

File: /home/user/Karasu/src-tauri/src/commands/list.rs

Line: 897–962 (`process_queue`); test module at 1082–1210

Function: `process_queue`

Problem:
`process_queue` is the offline-queue drain. Its own doc comment (list.rs:885–893)
names the property it exists for: anything that could succeed later aborts the
drain and leaves the whole queue intact, and only a payload AniList rejects on its
own terms is dropped, because replaying that one forever would wedge every edit
queued behind it — "that split is the entire point of this function". There is no
test for it. The `tests` module at line 1082 imports exactly `bulk_chunks`,
`queue_key`, `queue_parts` and `BULK_CHUNK`, and no reference to `process_queue`
exists anywhere in `src/` outside its definition, its call sites and comments.

Four untested behaviours in this one function, each a data-loss shape:

1. **The retryable/permanent split** (944–953). A misclassification in the
   retryable direction wedges the queue forever; in the permanent direction it
   silently discards a user's edit — the drop is announced through the bell
   (`report_dropped`) and nowhere else. `is_retryable` itself is well tested in
   `anilist/client.rs:888–1005`; the branch that consumes it is not.
2. **The drain-time account scope** (911–916). This is the v16 data-loss fix's
   second half. `db.rs` proves `queue_all(user_id)` filters (db.rs:2348–2372);
   nothing proves `process_queue` calls it with the *current* viewer rather than a
   stale one, or that a signed-out drain does nothing.
3. **Idempotence across a crash.** `db.queue_remove(id)` runs *after* the
   successful `api.query` (941), so a crash in that window replays the mutation on
   the next drain. For `save` that is idempotent by construction
   (`SaveMediaListEntry` is a set, not an increment) and for `delete` a repeat 404s
   and is dropped as permanent — but nothing states or pins that reasoning, so a
   future queued `kind` that is not idempotent would double-apply with no test in
   the way.
4. **`scoreFormat` re-stamping at drain** (932–936) and its deliberate
   non-application to `advancedScores` (documented at 923–931).

Expected Behavior:
A regression in any of the four is a red suite.

Actual Behavior:
All four are green by absence.

Reproduction:
`grep -n "process_queue" src-tauri/src/commands/list.rs` — one definition, one
call site, zero test references.

Impact:
The function whose failure modes are "the user's unsynced edits are thrown away"
and "the user's queue never drains again" has no automated coverage at all. This
is the highest consequence-per-missing-test ratio in the Rust tree.

Root Cause:
`process_queue` takes `&Db, &AniList, Option<&str>` and calls
`api.query(...).await` directly, so it cannot be driven without a transport seam.
`AniList` has no trait and no injectable client, which is what has kept the drain
untested.

Recommended Fix:
Extract the per-row decision as a pure function and test that, which needs no
seam:

```rust
enum RowOutcome { Flushed, Dropped(String), AbortDrain(String) }
fn row_outcome(result: Result<Value, ApiError>) -> RowOutcome
```

`process_queue` then becomes a loop over `row_outcome`. Separately extract the
payload preparation (`variables` + `scoreFormat` stamping + mutation selection) as
`fn prepare_row(kind: &str, payload: &str, score_format: &str) -> (&'static str, Value)`.

Regression Tests Required:
In `src-tauri/src/commands/list.rs`:
* `a_retryable_failure_aborts_the_drain_and_keeps_the_row` — `row_outcome` on each
  shape `client.rs` classifies retryable (429, 5xx, "Invalid token", network) is
  `AbortDrain`.
* `a_payload_anilist_refuses_is_dropped_rather_than_replayed_forever` — a 400
  validation error is `Dropped`.
* `a_save_is_restamped_with_the_current_score_format` —
  `prepare_row("save", …, "POINT_5")` emits `scoreFormat: "POINT_5"` and leaves
  `advancedScores` untouched.
* `a_delete_never_gains_a_score_format` — `prepare_row("delete", …)` adds nothing.
* In `src-tauri/src/db.rs`, `a_drain_reads_only_the_signed_in_account` — push rows
  for 111 and 222, set the cached viewer to 222, assert the ids `queue_all(viewer_id)`
  returns are 222's only. This is the frontier of the v16 fix that db.rs's own
  tests stop just short of.

Confidence: HIGH — the absence was confirmed by reading the test module's import
list, not by grep alone.

---

ID: C1-05

Severity: P2

Category: MISSING TEST

File: /home/user/Karasu/src-tauri/src/playback/scrobbler.rs

Line: 426–560 (`build_now_playing`), 796–880 (`requeue_match`)

Function: `build_now_playing`, `requeue_match`

Problem:
The scrobbler's *pure* functions are well tested — `would_regress`,
`block_reason`, `shift_episode`, `auto_arm`, `position_due`, `threshold` and
`applies_to` all have named behaviour tests with the bug that motivated them
written into the doc comment. The *composition* is not tested at all, and the
composition is where CLAUDE.md places four load-bearing rules:

1. **Correction before matcher.** `build_now_playing` consults
   `detection_override` (447) before `best_match` (468), mirroring `index_files`'
   documented order. Untested.
2. **Offset before redirect.** The offset is applied at 458–464 and the relations
   redirect at 493–512; both functions say in comments that the order "has to stay
   that way". No test pins it, and the two implementations of the same order are
   350 lines apart with nothing holding them together.
3. **`source_episode` is what a re-resolve reads.** `requeue_match` re-resolves
   from `np.source_episode` (810–812) precisely so "shifting an already-shifted
   number would drift further on every correction". Nothing pins it. Changing it
   to read `np.episode` compiles, passes the whole suite, and silently drifts the
   episode number by the offset on every correction the user makes.
4. **A redirect must not carry the correction's display title.** Both functions
   filter `forced.filter(|o| o.media_id == mid)` (522–526 and 858–861) so a
   redirect that moved to another entry does not misreport its title. Untested in
   both places.

Expected Behavior:
A test drives `build_now_playing` with a `Db` holding a `detection_override`
carrying an offset and a relations rule that redirects, and asserts the resulting
`NowPlaying`.

Actual Behavior:
`grep -rn "build_now_playing\|requeue_match" src-tauri/src/` returns the two
definitions (scrobbler.rs:426, :796), one call site each (scrobbler.rs:1059,
commands/playback.rs:491 and :512) and comment references. Zero test references.

Reproduction:
As above.

Impact:
The composition decides which AniList entry and which episode number a scrobble
writes. `would_regress` catches a backwards write and `block_reason` catches a
gap, but neither catches "the right direction on the wrong entry" or "one episode
ahead on every correction". Those are silent wrong writes to a user's list, which
is the class of harm the whole v12/v13 design exists to prevent.

Root Cause:
`build_now_playing` is testable today — it takes `&Db`, `&[relations::Rule]` and a
plain `Playback`, with no `AppHandle`. It simply has no test. `requeue_match`
takes `&AppHandle` and reaches `app.state::<PlaybackState>()` and
`app.state::<Relations>()`, so it is not unit-testable without extracting its
decision.

Recommended Fix:
Test `build_now_playing` directly against a `Db::open(tempdir)`. Extract
`requeue_match`'s decision into a pure
`fn resolve_correction(forced: Option<&DetectionOverride>, source_episode: Option<u32>,
parsed_title: &str, season: Option<u32>, candidates: &[Candidate], rules: &[Rule],
media_type: &str) -> (Option<i64>, Option<u32>)` and call it from both, so the
"same order" comment becomes a shared call rather than a duplicated one.

Regression Tests Required:
In `src-tauri/src/playback/scrobbler.rs`:
* `a_correction_beats_the_matcher` — a `detection_override` on
  `(title, season, "ANIME")` wins over a candidate list whose fuzzy best is a
  different id; `overridden` is true and `matched_title` is the stored
  `display_title`.
* `an_offset_lands_before_the_redirect` — override with `episode_offset = 12` plus
  a relations rule mapping `#A ep 13 -> #B ep 1`; assert the result is `(#B, 1)`
  and `source_episode == Some(1)`. Under the reversed order it would be `(#A, 13)`.
* `a_redirect_does_not_borrow_the_corrections_title` — same setup, assert
  `matched_title` is not the override's `display_title` once the redirect moved to
  `#B`.
* `re_resolving_twice_does_not_shift_twice` — `resolve_correction` called twice
  with the same `source_episode` returns the same episode both times. This is the
  one that catches a change from `source_episode` to `episode`.
* `clearing_a_correction_returns_the_matchers_guess` — with `forced == None` the
  fallback at 826–839 produces the same id `best_match` does.

Confidence: HIGH

---

ID: C1-06

Severity: P2

Category: MISSING TEST

File: /home/user/Karasu/src/hooks/useListMutations.ts

Line: 86–162 (`applyInput`, `patchCacheMany`), 170–235 (`save`), 262–297 (`bulkSave`)

Function: `applyInput`, `patchCacheMany`, `bulkSave.onError`

Problem:
`lib/receipt.ts` — the pure half of the edit flow — has 21 named tests covering
`inverse` including the "changed to zero, which is falsy but real" case and the
round trip. The *cache* half has none. Three behaviours whose comments explain the
bug they fix are unpinned:

1. `applyInput` uses `??` throughout with an explicit note that `||` would be
   wrong because `private: false` is a real value (89–121). Nothing asserts that
   `private: false` and `progress: 0` survive. A `||` regression is a
   one-character edit that quietly refuses to clear a flag or reset progress.
2. `patchCacheMany`'s status-group move (128–162) removes an entry from its old
   status group and prepends it to the new one. Untested.
3. `bulkSave.onError`'s partial/total split (274–283):
   `const partial = err instanceof BulkSaveError && err.updated > 0` — on a
   partial failure it **invalidates** instead of restoring the snapshot, because
   restoring then would show the old values for entries AniList has already
   changed, "worse than the failure itself, because it looks settled". That is the
   more dangerous of the two branches and nothing pins which one runs.

Expected Behavior:
Each has a test.

Actual Behavior:
`src/hooks/` contains three test files — `useColumnCount.test.ts`,
`useDialogFocus.dom.test.tsx`, `useGridRoving.dom.test.tsx`. 21 of the 24 hooks
are untested, and `useListMutations` is the largest of them.

Reproduction:
`ls src/hooks/*.test.*`.

Impact:
A wrong optimistic patch shows the user a state the server does not hold; a wrong
rollback shows the user a state the server *did* hold before a partial write. Both
look settled and neither reports anything. The receipt/undo machinery is
protected; the cache it writes into is not.

Root Cause:
`applyInput` and the cache transform are pure functions of `(entry, input)` and
`(ListResult, ids, input)`, but they are defined inside the hook, closed over
`qc`, so they cannot be imported. This is the case CLAUDE.md's "prefer extracting
pure logic into `src/lib/*.ts`" convention is about.

Recommended Fix:
Move `applyInput` and the cache transform to `src/lib/listPatch.ts` as
`applyInput(entry, input, now)` and `patchLists(lists, ids, input, now)`; the hook
keeps only `qc.setQueryData(key, (old) => old && { ...old, lists: patchLists(...) })`.

Regression Tests Required:
New `src/lib/listPatch.test.ts` (node project — pure, no DOM):
* `an_absent_field_is_left_alone` and `an_explicit_false_is_written` —
  `private: false` and `hiddenFromStatusLists: false` overwrite `true`;
  `progress: 0` overwrites `5`. This is the `??`-vs-`||` guard.
* `custom_lists_are_replaced_only_when_supplied` — `customLists: undefined` keeps
  the map; `customLists: []` clears it.
* `advanced_scores_are_not_patched_optimistically` — the note at 116–121.
* `a_status_change_moves_the_entry_between_groups` — one group loses it, the
  target group gains it at the head, custom lists keep it.
* `a_bulk_patch_touches_only_the_selected_ids`.

Plus `src/hooks/useListMutations.dom.test.tsx` for the rollback split alone:
* `a_total_bulk_failure_restores_the_snapshot`.
* `a_partial_bulk_failure_invalidates_instead_of_restoring` — throw
  `BulkSaveError` with `updated: 3`, assert `invalidateQueries` ran and the cache
  was not reset.

Confidence: HIGH

---

ID: C1-18

Severity: P2

Category: BUG

File: /home/user/Karasu/src-tauri/src/logging.rs

Line: 683–699 (`the_ring_is_bounded_and_newest_first`)

Function: `logging::tests::the_ring_is_bounded_and_newest_first`

Problem:
The same race as C1-02, in a second test, and C1-02's recommended one-line fix
does not cover it. The test takes `serialize()`, pushes `RING_CAPACITY + 50`
entries under the `"ringtest"` target, then asserts `all[0]` is *its own* newest
entry. Its own comment states the hazard while relying on a lock the offending
writer never takes:

```rust
// The lock is also what makes "newest first" checkable at all: any
// concurrent writer's entry would land on top of ours.
let _serial = serialize();
```

The unsynchronised writer that breaks C1-02 is `sync.rs:49`'s panic going through
the process-global hook into the same ring via `log` (logging.rs:302–322). That
writer takes no lock, so it can land on top between the last `info(...)` push and
the `entries(RING_CAPACITY * 2)` read here exactly as it does in
`the_panic_hook_records_the_panic`.

Expected Behavior:
`all[0]` is the test's own `entry {RING_CAPACITY + 49}` regardless of what else
the binary is doing.

Actual Behavior:
It is whatever was written last, including a foreign panic entry. Not observed
failing during this audit — the window is one statement wide rather than C1-02's —
but the mechanism is identical and C1-02 has been observed failing on six of nine
runs across three passes.

Reproduction:
Not reproduced on demand; the exposure is read off the source. C1-02's
reproduction (`--skip sync::` flips the parallel run green) demonstrates that
`sync.rs`'s panic entry does reach this ring during a parallel run.

Impact:
A second intermittent failure in the one gate CI runs on every pull request,
latent behind the first. Fixing C1-02 by tightening its predicate — the correct
fix for that finding — leaves this one exposed, so the gate would appear repaired
and then flake again later against a change that has nothing to do with logging.

Root Cause:
`serialize()` orders the logging tests against each other and cannot order them
against a writer outside the module. `install_panic_hook` stays installed for the
rest of the binary once any test has called it, so every subsequent panic anywhere
in the crate is a writer to this ring.

Recommended Fix:
Filter to the test's own target rather than trusting position:
`entries(RING_CAPACITY * 2).iter().filter(|e| e.target == "ringtest")` and assert
on that list's first element and length. The bound assertion (`all.len() <=
RING_CAPACITY`) stays as it is — it is about the ring, not about ownership. The
durable alternative is to stop the unsynchronised panic writer: have `sync.rs`'s
test panic through a hook-free path, or take `GLOBAL_LOG_STATE` — but the latter
couples an unrelated module to the logger's test lock, which C1-02 rejects for
good reason.

Regression Tests Required:
No new test; this is a fix to an existing one. Verify by running
`cargo test --lib` at default parallelism ten times after fixing both C1-02 and
this, and by running `cargo test --lib -- --test-threads=1` to confirm the
serial path is unchanged. If a cheap guard is wanted, the
`a_second_panic_from_elsewhere_does_not_take_the_entry` test proposed under C1-02
covers the shared mechanism for both.

Confidence: HIGH on the mechanism, MEDIUM on the failure rate — the race is
proven by C1-02's reproduction, but this particular test was not observed failing.
Source: found during adversarial verification.

---

ID: C1-03

Severity: P3

Category: MISSING TEST

File: /home/user/Karasu/src-tauri/src/playback/recognition/matcher.rs

Line: 286–345 (`best_match_reference` and `prepared_agrees_with_the_original_algorithm`)

Function: `prepared_agrees_with_the_original_algorithm`

Problem:
CLAUDE.md says of this test: "`matcher.rs`'s equivalence test checks the optimized
path against a copy of the original algorithm — keep that copy honest." The copy
is honest about the *loop* and nothing else. `best_match_reference` calls the same
`variants` (294), the same `normalize` (299) and the same `similarity` (307),
which is `dice(&trigrams(a), &trigrams(b))` (61). Every scoring primitive is
shared, so the equivalence test can only ever detect a change to candidate
iteration, title ordering, or the hoisting `prepare` does. It is structurally
incapable of detecting a change to `normalize`, `variants`, `trigrams` or `dice`.

Expected Behavior:
The matcher suite fails when the advertised season spellings change.

Actual Behavior:
It does not. A standalone harness built from verbatim copies of `matcher.rs` and
`parser.rs` (the only edits: rerouting two `use` paths and dropping a
`serde::Serialize` derive), compiled with `rustc --test` against the repo's own
`regex` rlib, is green at 27 tests unmutated. Both passes of this audit built the
harness independently and got the same baseline. Then, one mutation at a time:

* **Delete matcher.rs:113, `out.push(format!("{stripped} {season}"))`** — the
  `"Show 2"` spelling the module doc advertises as one of the three season forms
  it covers ("Title S2" ↔ "Title 2nd Season" ↔ "Title Season 2"). Result:
  **27 passed, 0 failed.** Invisible. And invisible repo-wide: no other test
  exercises a bare `"Title 2"` season spelling.
* **Change `dice` from `(2.0 * common)/(len+len)` to `common/(len+len)`.** Result:
  one failure, and it is `first_candidate_wins_a_tie`;
  `prepared_agrees_with_the_original_algorithm` itself passed against the mutant.
  The equivalence test caught nothing here either.

Reproduction:
Copy `matcher.rs` and `parser.rs` into a scratch crate, apply either mutation,
run `rustc --test`. Green in the first case.

Impact:
Dropping the `"Show 2"` season form is a silent detection regression for every
release group that spells a sequel that way, with a green suite. CLAUDE.md is
explicit that season variant generation is a decision worth protecting — it is
the subject of the "the season is inert for matching unless the *title* carries
it" section — and the one test named as its guard cannot see it.

Verification: downgraded from P2 — the report's sharpest claim, that removing
`.to_lowercase()` from `normalize` leaves the suite green and silently stops
scrobbling for every shouted title, is refuted by the real crate. `normalize` has
a second caller, `identify.rs:71` (`batch_query`), and
`identify.rs:216–224`'s `a_quote_in_a_title_cannot_escape_the_query` asserts
`q.contains("kimi no na wa")` against the input `"Kimi \" no \" Na wa"`. Without
the fold that normalises to `"Kimi no Na wa"` and the assertion fails. The case
fold *is* pinned — incidentally, and from the wrong module, but pinned. The
harness was green only because it held two files out of the crate. What survives
is the narrower, real gap: the equivalence test proves less than its CLAUDE.md
note implies, and the season spellings are unpinned. No live defect.

Root Cause:
The reference implementation shares its primitives with the implementation under
test, so the "independent check" is independent only of the part that was
optimized.

Recommended Fix:
Not a code fix — tests. Keep the equivalence test for what it does prove
(ordering and tie-breaking under `prepare`) and add direct tests for the
primitives it cannot see. Consider also amending the CLAUDE.md line so it says
what the copy actually guards.

Regression Tests Required:
In `src-tauri/src/playback/recognition/matcher.rs`:
* `every_season_spelling_reaches_the_same_entry` — for each of
  `"Kusuriya no Hitorigoto S2 - 05.mkv"`, `"Kusuriya no Hitorigoto 2 - 05.mkv"`,
  `"Kusuriya no Hitorigoto Season 2 - 05.mkv"` and
  `"Kusuriya no Hitorigoto 2nd Season - 05.mkv"`, assert `best_match` returns
  166531 against a candidate list holding **only** the
  `"Kusuriya no Hitorigoto 2nd Season"` title (drop the English one, so the bare
  `"… 2"` form cannot win by an unrelated exact hit). This is the assertion the
  mutation defeats.
* `normalize_folds_case_and_punctuation` —
  `assert_eq!(normalize("Sousou NO Frieren!"), normalize("sousou no frieren"))`
  and `assert_eq!(normalize("A: B - C"), "a b c")`, so the fold is pinned in the
  module that owns it rather than by an unrelated `identify.rs` assertion.
* `dice_is_the_dice_coefficient` —
  `assert_eq!(dice(&trigrams("abc"), &trigrams("abc")), 1.0)`, pinning the `2.0 *`
  at the primitive rather than through a tie-break.

Confidence: HIGH on the residual gap; the refuted half is recorded above rather
than dropped, because the refutation itself is a fact worth keeping — the fold's
only guard is in another module and would vanish if that test were rewritten.

---

ID: C1-07

Severity: P3

Category: MISSING TEST

File: /home/user/Karasu/scripts/release/generate-update-manifest.ps1

Line: 68 (`$fullVersion = "$packageVersion+$commitNumber"`)

Function: n/a (release script)

Problem:
CLAUDE.md is explicit that spelling the commit number as a fourth dotted segment
instead of semver build metadata makes every install fail with *"unexpected
character '.' after patch version number"*. The Rust side pins the **reader**:
`the_manifest_spelling_compares_equal_to_the_dotted_one` (update.rs:359–374) and
`build_metadata_reads_as_the_fourth_segment` (update.rs:407–414). Nothing pins the
**writer**. Both tests use hardcoded literals (`let manifest = "0.136.4+361";`)
and never look at `generate-update-manifest.ps1`, so editing line 68 to
`"$packageVersion.$commitNumber"` leaves the entire suite green.

A second, related hole: the manifest's version core comes from `package.json`
(line 67) while the running build's comes from `Cargo.toml`
(`env!("CARGO_PKG_VERSION")`, update.rs:18). `bump-version.mjs` keeps
`package.json`, `Cargo.toml` and `tauri.conf.json` in step, but nothing asserts
they are in step. All three read `0.190.0` today; a hand-edit or a half-applied
bump makes the manifest describe a version the running build does not have, and
the comparator then either never offers an update or offers one forever.

Expected Behavior:
A test fails when the generator's spelling changes, and a test fails when the
three manifests drift.

Actual Behavior:
Neither exists. The five PowerShell scripts under `scripts/release/` have no
automated coverage of any kind; the only gate is `release.yml:199`, which runs
`release-notes.ps1` as a precheck and says nothing about the update manifest.

Reproduction:
`grep -rn "generate-update-manifest" src src-tauri/src` — no hits outside the
workflow.

Impact:
A wrong spelling here is release-breaking for the whole updater and is discovered
by users, not by CI. It cannot damage an install that is already working — the
update check errors and the app keeps running.

Verification: downgraded from P2 — the failure needs a deliberate edit against a
six-line comment sitting directly above the line, on a file touched once a
release, and `bump-version.mjs` is the only sanctioned writer of the three
manifests. There is no live defect and no drift today, which puts it below "the
offline-queue drain has no tests".

Root Cause:
The invariant spans a PowerShell writer and a Rust reader, and only the reader is
in a test harness.

Recommended Fix:
Pin the writer by reading it. A vitest in the node project can read the script
text off disk with `import.meta.glob(..., { query: "?raw" })`, which is the
pattern `i18nKeys.test.ts` already uses.

Regression Tests Required:
New `src/lib/releaseManifest.test.ts` (node project):
* `the_update_manifest_spells_the_commit_number_as_build_metadata` — the text of
  `scripts/release/generate-update-manifest.ps1` contains
  `$fullVersion = "$packageVersion+$commitNumber"` and contains no
  `"$packageVersion.$commitNumber"`.
* `the_three_manifests_carry_the_same_semver_core` — `package.json`'s `version`,
  `src-tauri/Cargo.toml`'s `version = "…"` and `src-tauri/tauri.conf.json`'s
  `version` are string-equal.
* `the_commit_number_is_a_bare_integer` — `COMMIT_NUMBER: u32 = <digits>;` matches
  in `src-tauri/src/commands/update.rs`, which is the regex the generator itself
  relies on at line 57.

Confidence: HIGH

---

ID: C1-08

Severity: P3

Category: MISSING TEST

File: /home/user/Karasu/src/lib/contentFilter.ts (the rule), 21 call sites

Line: n/a

Function: `isBlocked`, `shouldBlur`, `blockReason`

Problem:
`src/lib/contentFilter.test.ts` covers the *rule* thoroughly — 27 assertions
across `blockReason` (adult wins over suggestive), `isBlocked`, `isBlockedGenre`,
`adultQueryArg`, `toLevel` and `shouldBlur`, including the "never veils a
suggestive genre" case. What is largely untested is whether each surface
*applies* it. Twenty-one non-test files import `isBlocked` or render
`FilteredNotice`:

```
components/media/{MediaStrip,RecommendedSection,SeasonHero}
components/overlays/{MatchPicker,SeasonSplitModal}
components/shell/CommandPalette
components/social/{ActivityFeed,UserLists}
components/stats/LocalStatistics
pages/{Activity,AnimeDetail,Calendar,Dashboard,LocalLibrary,MediaList,Search,
       Seasonal,Statistics,UserProfile,Wrapped}
```

Expected Behavior:
At least the surfaces that render third-party or search results have a test that
a blocked title does not appear.

Actual Behavior:
One of the twenty-one does. `src/components/media/SeasonHero.dom.test.tsx:63–69`
is exactly the test the other twenty need, against `SeasonHero.tsx:53`'s
`filter((m) => !isBlocked(m, level))`:

```tsx
it("drops a title the content filter blocks", async () => {
  useContentFilter.setState({ level: "moderate", ready: true, error: null });
  hero.mockResolvedValue([media(1, "Blocked", { isAdult: true }), media(2, "Fine")]);
  …
  expect(screen.queryByRole("link", { name: "Blocked" })).toBeNull();
});
```

The other file with a test, `src/pages/Seasonal.dom.test.tsx`, tests the *badge*
rather than the hiding — its own comment says "the badge only ever appears with
the filter off".

Reproduction:
`grep -rln "isBlocked\|FilteredNotice" src --include=*.tsx | grep -v test` → 21
files; of those, two have test files and one tests the hiding.

Impact:
The user-visible promise of the setting is "I will not see this". A new surface,
or a refactor that drops a `.filter()`, breaks that promise on one screen with a
green suite — and CLAUDE.md's `FilteredNotice` rule ("the one disclosure line
every surface renders", so "the three surfaces that show it cannot drift apart")
is unenforced. The rule module itself is correct and every current call site does
call it; the risk is regression, not present breakage.

Verification: downgraded from P2 — the original framing ("exactly one of them has
a test … and it tests the badge, not the hiding", "Actual Behavior: None do") is
wrong. `SeasonHero.dom.test.tsx` tests precisely the hiding, so the application
layer is not uncovered and even carries the pattern the other twenty would copy.

Root Cause:
Pages are untested wholesale (`Seasonal` is the only page with a test file), so an
application-site invariant has nowhere to live.

Recommended Fix:
Two layers: a cheap static one, plus dom tests for the highest-traffic surfaces,
copied from `SeasonHero.dom.test.tsx`.

Regression Tests Required:
* Static, new `src/lib/contentFilterSites.test.ts` (node project, the same
  `import.meta.glob` raw-source technique as `i18nKeys.test.ts`): assert that every
  file importing `MediaCard` or `MediaStrip` and holding a
  `useQuery`/`useInfiniteQuery` also mentions `isBlocked` or `FilteredNotice`,
  against an explicit allow-list of exemptions with a comment per entry.
  Deliberately shaped like `i18nKeys.test.ts`'s dead-key direction: an exemption
  list is a decision someone has to write down.
* `src/pages/Search.dom.test.tsx` — with `level = "strict"`, an `isAdult` result
  and an `Ecchi`-genre result are both absent from the output and `FilteredNotice`
  reports 2.
* `src/pages/Dashboard.dom.test.tsx` and
  `src/components/shell/CommandPalette.dom.test.tsx` — the same shape.
  CommandPalette in particular filters inside a loop (`CommandPalette.tsx:121`),
  which is the easiest place for a `continue` to be lost.

Confidence: HIGH on the residual gap (20 surfaces).

---

ID: C1-10

Severity: P3

Category: MISSING TEST

File: /home/user/Karasu/src-tauri/src/db.rs

Line: 510–630 (`Db::open`), test at 1771–1823

Function: `Db::open`

Problem:
`a_database_left_mid_upgrade_still_opens` is a genuinely good test — it drives the
real `Db::open` on a real directory and walks all five `ALTER TABLE ADD COLUMN`
guards (v7, v13, v14, v15, v16). Three adjacent cases are missing:

1. **An old binary meeting a newer `user_version`.** Set `PRAGMA user_version = 99`
   and reopen. From reading `Db::open` this is safe — every step is
   `if version < N` over a base `CREATE TABLE IF NOT EXISTS` batch — but it is safe
   by accident of the current shape and nothing says so; a future migration that
   backfilled unconditionally would break it silently. The case is realistic: a
   user who installs a nightly, then reinstalls the stable build.
2. **Full re-runnability.** The test reopens after each half-migration, so the
   no-op path is exercised, but nothing opens the same directory twice in a row
   from a clean state and asserts the second open is a no-op that preserves rows.
3. **Data survival across the guarded branches.** The loop asserts only
   `user_version == 17`, never a row. When the guard takes the
   `apply(&conn, N, "PRAGMA user_version = N;")` branch it deliberately skips the
   migration body — for v16 that body is the `UPDATE` backfill and the `DELETE`
   (db.rs:326–329). The test never puts a row in `offline_queue` before winding the
   version back, so it cannot tell "the guard correctly recognised the column was
   there" from "the guard silently skipped a backfill that had not run".

Additionally, `mem_db()` (db.rs:1509–1530) runs each `MIGRATION_V*` through bare
`execute_batch`, not through `apply`. That is fine for what it is, but it means
the transactional wrapping `apply` exists for (db.rs:485–497) is exercised only by
this one `Db::open` test.

Expected Behavior:
Each of the three has a named assertion.

Actual Behavior:
None do.

Reproduction:
Read db.rs:1771–1823 — the loop's only assertion is on `user_version`.

Impact:
Migration bugs are the highest-consequence class in the app: a database that will
not open is a total outage with no in-app recovery. The existing test covers the
failure mode that actually shipped; these three are its neighbours. (The third is
also filed as A4-16 in `DATA_INTEGRITY.md`, and the "newer database" case as
A4-05.)

Root Cause:
The test grew from a specific incident (the v7 interruption) and pins that
incident's shape.

Recommended Fix:
Extend the existing test rather than adding a parallel one, so the setup is
shared.

Regression Tests Required:
In `src-tauri/src/db.rs`:
* `a_database_from_a_newer_build_still_opens` — `Db::open`, set
  `PRAGMA user_version = 99`, reopen, assert `Ok` and that `user_version` is still
  99 (not clobbered back to 17).
* `opening_twice_changes_nothing` — open, write a `local_list` row and a `kv` key,
  drop, reopen, assert both are unchanged and `user_version == 17`.
* `the_v16_guard_does_not_hide_an_unattributed_row` — inside the existing loop,
  before winding to version 15, insert an `offline_queue` row with `user_id`
  already set; after the reopen assert it is still there with its owner intact.
  That distinguishes the guard from a skipped backfill.

Confidence: HIGH

---

ID: C1-12

Severity: P3

Category: MISSING TEST

File: /home/user/Karasu/src-tauri/src/commands/playback.rs

Line: 34–46 (`read_scrobble_settings`), 66–76 (`MEDIA_DETECTION_KEY`, `read_media_detection`)

Function: `read_scrobble_settings`, `read_media_detection`

Problem:
Two settings invariants stated in comments, neither pinned:

1. `const MEDIA_DETECTION_KEY: &str = "smtc_enabled"` (line 70). CLAUDE.md:
   "renaming the key would reset every existing user's opt-out". The comment at
   66–69 says so too. Nothing asserts the literal.
2. Fresh-install defaults (38–42): `confirm` is false unless the key is exactly
   `"1"`, `delay_min` is 0 on a parse failure. `delay_min == 0` is what routes
   `threshold()` to the two-thirds-of-episode branch (tested in scrobbler.rs), so
   the default is load-bearing for the tested logic and is itself untested. Same
   for `read_media_detection`'s `!= Some("0")` (line 75, i.e. default on) and
   `get_blur_adult` at prefs.rs:248 — though `blur_adult`'s *seeding* is well
   covered by `v17_blurs_by_default_only_where_nothing_was_ever_stored` and
   `v17_leaves_an_explicit_choice_alone` in db.rs.

Expected Behavior:
A rename of the kv key, or an inverted default, is a red suite.

Actual Behavior:
Neither is asserted anywhere. `commands/prefs.rs` has no `mod tests` at all.

Reproduction:
`grep -n "MEDIA_DETECTION_KEY" src-tauri/src` — the definition and its uses, no
assertion.

Impact:
A key rename silently resets an opt-out for every existing user — a settings-loss
regression that nothing reports and that CLAUDE.md flags as a known trap. An
inverted default turns scrobble confirmation on or off for everyone on upgrade.

Root Cause:
The key-name assertion needs nothing at all and is simply absent; the defaults
were left to the command layer.

Recommended Fix:
Add the three tests to the `mod tests` that already exists in
`commands/playback.rs`. Two corrections to the original filing, both in the
finding's favour on cost: `commands/playback.rs` *does* have a `mod tests`
(playback.rs:516–539, `only_a_real_pipe_shape_reaches_the_probe`), and the
`pub(crate) fn …_from(db: &Db)` readers the original fix proposed **already
exist** — `read_scrobble_settings(db: &Db)` (playback.rs:34) and
`read_media_detection(db: &Db)` (playback.rs:73) are exactly that shape and the
commands already delegate to them. The tests can be written against `mem_db()`
today with no refactor at all.

Regression Tests Required:
In `src-tauri/src/commands/playback.rs`:
* `the_media_detection_key_is_still_spelled_smtc_enabled` — one line,
  `assert_eq!(MEDIA_DETECTION_KEY, "smtc_enabled")`, with the CLAUDE.md reason in
  the doc comment. This is the cheapest high-value test in the audit.
* `a_fresh_install_confirms_nothing_and_waits_two_thirds` — against `mem_db()`,
  `read_scrobble_settings(&db)` is `{ confirm: false, delay_min: 0 }`.
* `detection_is_on_until_it_is_turned_off` — absent key → true; `"0"` → false;
  `"1"` → true.

Confidence: HIGH

---

ID: C1-13

Severity: P3

Category: MISSING TEST

File: /home/user/Karasu/src/api/franchise.ts

Line: 146–201 (the BFS loop)

Function: `loadFranchise`

Problem:
CLAUDE.md lists "bound BFS/traversal work; never fan out unboundedly" as a hard
constraint under the AniList rate limit. `loadFranchise` is the only BFS in the
app, and `src/api/` has no tests at all — seven files, 4,234 lines, zero test
files. Reading it, the bound holds structurally: `depth <= MAX_DEPTH` with
`MAX_DEPTH = 3` caps it at four requests, `ids.slice(0, 50)` caps each request,
and `nodes.size >= MAX_NODES` breaks out. Three finer behaviours are unpinned,
each commented with the bug it fixes:

* `truncated` is set when the frontier exceeds 50 (152–154) or the node cap is hit
  (199–201). Its whole purpose is that dropping the remainder silently is the one
  thing a relations view must not do.
* The `!next.includes(node.id)` hub dedupe (190–194), added because a hub "ate
  slots out of the 50 above that other nodes then never got".
* `hidden()` dropping a filtered node *and* its edges *and* its traversal
  (120–137), so the graph never renders an edge into something invisible.

Expected Behavior:
Each has an assertion against a stubbed `gql`.

Actual Behavior:
None. `ls src/api/*.test.*` → nothing.

Reproduction:
As above.

Impact:
A regression that removed the dedupe or widened `MAX_DEPTH` would spend the
~30/min budget the scrobbler and the three alert passes share, and the limiter
"cannot see a burst it has not sent". A regression that dropped `truncated` would
render an incomplete franchise as complete. Neither is a data-loss shape.

Root Cause:
`loadFranchise` imports `gql` from `./anilist`, which is mockable with `vi.mock`,
so this is a gap of intent rather than of testability.

Recommended Fix:
Test it with a stubbed `gql` that serves a fixture graph and counts calls.

Regression Tests Required:
New `src/api/franchise.test.ts` (node project; `vi.mock("./anilist")`):
* `a_cyclic_graph_terminates` — A↔B↔C↔A; assert the call count is ≤ 4 and the
  result is finite.
* `a_frontier_wider_than_a_page_reports_truncation` — 60 sequels off the root;
  assert `truncated === true` and that exactly 50 ids went into the second request.
* `a_hub_is_queued_once_however_many_parents_reach_it` — two parents both relating
  to the same sequel; assert the id appears once in the request's `ids`.
* `a_filtered_node_leaves_no_edge_behind` — with `level = "strict"` and an
  `isAdult` sequel, assert neither the node nor any edge naming it is in the graph.
* `the_node_cap_stops_the_walk` — assert `nodes.length <= 60` and
  `truncated === true`.

Confidence: HIGH

---

ID: C1-14

Severity: P3

Category: MISSING TEST

File: /home/user/Karasu/src/stores/theme.ts

Line: 174–195 (`storedCoverCols`), 50–51 (`defaultCoverCols`)

Function: `storedCoverCols`

Problem:
Six of seven Zustand stores are untested; `auth` is the exception. The
highest-value gap among them is `theme`'s one-time density migration, which
CLAUDE.md calls out explicitly ("a one-time migration from the old s/m/l keys")
alongside two shapes that "died here and should stay dead". The function reads
`karasu-cover-cols`, falls back to migrating `karasu-density` through a
shell-width-dependent map (`{s:3,m:2,l:2}` narrow vs `{s:10,m:8,l:7}` wide),
**deletes the old key** — before writing the new one — and otherwise falls back to
a UA-keyed default (4 on Android, 10 elsewhere).

The delete is what makes this one-shot and therefore untestable-by-retry in
production: if the mapping is wrong, the old value is already gone.

Expected Behavior:
The migration table, the delete, the clamp and the UA default each have an
assertion.

Actual Behavior:
None. `ls src/stores/*.test.*` → `auth.dom.test.tsx` only.

Reproduction:
As above.

Impact:
A user upgrading from the s/m/l era gets a silently wrong grid density with no way
to recover the old preference. Cosmetic, one-time, per-user.

Root Cause:
`storedCoverCols` is module-private and runs at store construction, so it can only
be reached through the store's `init`.

Recommended Fix:
Export `storedCoverCols` (or a pure
`coverColsFrom(saved, density, narrow, isAndroid)`) and test the pure form in the
node project.

Regression Tests Required:
New `src/stores/theme.dom.test.tsx`, or a node test against the extracted pure
form:
* `a_saved_column_count_wins_and_is_clamped`.
* `the_old_density_setting_migrates_once_and_is_deleted` — set
  `karasu-density = "m"`, read, assert the mapped value **and** that
  `localStorage.getItem("karasu-density")` is now null, and that a second read
  returns the same number from the new key.
* `each_density_maps_per_shell_width` — the six entries of the two maps,
  explicitly.
* `a_first_run_defaults_by_platform` — Android UA → 4, otherwise 10.
* `a_write_that_throws_does_not_break_the_read` — the `try/catch` at 187–190.

Confidence: HIGH

---

ID: C1-15

Severity: P3

Category: MISSING TEST

File: /home/user/Karasu/src/hooks/useColumnCount.ts

Line: 63 (the effect's dependency array)

Function: `useColumnCount`

Problem:
`src/hooks/useColumnCount.test.ts` is correctly filed in the node project and
tests `parseColumnCount` well, including the `none` / unset-token collapse. The
hook around it is untested, and CLAUDE.md marks one specific piece of it
load-bearing: "`VirtualGrid`'s `watch={coverCols}` re-measure is load-bearing —
the ResizeObserver cannot see a track re-flow that leaves the probe's own size
alone." That is a statement about the hook's dependency array, and nothing asserts
it.

Expected Behavior:
A test renders the hook, changes `watch`, and asserts a re-measure happened.

Actual Behavior:
No test touches the hook. Dropping `watch` from `[ref, watch]` compiles,
type-checks and passes all 935 tests. `VirtualGrid.tsx:47` passes `coverCols` as
that `watch` and chunks rows by the result (`:48`, `:95`), so the grid then keeps
the previous column count after a covers-per-row change and the rows are chunked
wrong until something else forces a re-measure.

Reproduction:
Read `src/hooks/useColumnCount.test.ts` — it imports `parseColumnCount` and
nothing else.

Impact:
A visible mis-render of the main list, recoverable by resizing the window.
Transient and cosmetic, but the invariant is documented as load-bearing and is one
character from being lost.

Root Cause:
The pure part was extracted and tested; the effect was not.

Recommended Fix:
A dom test using `renderHook`. jsdom has no layout, so stub `getComputedStyle` to
return a scripted `gridTemplateColumns` and assert the hook re-reads it.

Regression Tests Required:
New `src/hooks/useColumnCount.dom.test.tsx`:
* `a_change_to_watch_forces_a_re_measure` — mock `getComputedStyle` to return
  `"150px 150px"` then `"150px 150px 150px"`; rerender with a new `watch` value;
  assert the reported count moves 2 → 3 with no resize event. This is the
  assertion that fails when `watch` leaves the deps.
* `a_detached_element_reads_as_one_column` — the fallback `parseColumnCount`
  already guarantees, asserted through the hook so the wiring is covered too.

Confidence: HIGH

---

ID: C1-19

Severity: P3

Category: MISSING TEST

File: /home/user/Karasu/src/api/anilist.ts

Line: 51–52 (`isTokenRejected`), with 43–49 (the comment) and 62–82 (`guarded`)

Function: `isTokenRejected`

Problem:
`isTokenRejected` decides whether an error means "your AniList token is dead" and
therefore whether every screen in the app raises the global session-expired
banner. Its comment states the property and the reason:

```ts
/**
 * Matched exactly rather than by substring: an entry's notes can contain any
 * text at all, and a queued edit whose body happened to mention this must not
 * sign the user out.
 */
export const isTokenRejected = (e: unknown): boolean =>
  (e instanceof Error ? e.message : String(e)).trim() === TOKEN_REJECTED;
```

Nothing tests it. It sits inside the "`src/api` has zero tests" gap C1-13 opens,
but it is a sharper and far cheaper case than the BFS: loosening `=== TOKEN_REJECTED`
to `.includes(TOKEN_REJECTED)` is a one-word edit that compiles, type-checks and
passes all 935 tests.

Expected Behavior:
An error whose message merely *contains* the code — because a user's own note text
was echoed back in it — is not a token rejection.

Actual Behavior:
Unasserted in either direction: neither that the exact code is recognised, nor
that a containing string is not.

Reproduction:
`ls src/api/*.test.*` → nothing; `grep -rn "isTokenRejected" src --include=*.test.*`
→ nothing.

Impact:
A loosened predicate signs the user out on arbitrary user-authored content, and it
feeds two consumers: the global sign-out banner (`anilist.ts:75–81`) and the retry
policy (`app/main.tsx:32`). The tightening direction is just as bad — a change that
made the match stricter would leave a dead token failing every screen with no
banner, which is the exact symptom the `guarded` comment says the handler was
written to fix.

Root Cause:
`src/api` has no test file at all, so the module's cheapest invariant has nowhere
to live.

Recommended Fix:
None to the code — it is correct. Add the test.

Regression Tests Required:
New `src/api/anilist.test.ts` (node project; the function is pure and imports
nothing that needs a DOM):
* `the_exact_code_is_a_rejection` — `isTokenRejected(new Error(TOKEN_REJECTED))`
  and the whitespace-padded form are both true (the `.trim()` is deliberate).
* `a_note_that_merely_mentions_the_code_is_not` —
  an error whose message is `Validation error: notes "see anilist.tokenRejected"`
  is not a rejection. This is the assertion the one-word edit fails.
* `a_non_error_value_does_not_throw` — a plain string and `undefined` both return
  a boolean, since the call site passes whatever `invoke` rejected with.

Confidence: HIGH
Source: found during adversarial verification.

---

ID: C1-20

Severity: P3

Category: MISSING TEST

File: /home/user/Karasu/src/api/anilist.ts

Line: 240–253 (`bulkSaveEntries`' invoke payload)

Function: `bulkSaveEntries`

Problem:
The same `??`-vs-`||` trap C1-06 names on the cache half, on the payload half, and
equally untested. The comment states the contract:

```ts
// Nulls rather than omissions: the Rust command forwards each straight into
// the GraphQL variables, and an absent variable and an explicit null mean the
// same thing to AniList — "do not change this".
```

followed by `private: patch.private ?? null`, `progress: patch.progress ?? null`,
`repeat: patch.repeat ?? null` and five more of the same shape. Replacing any `??`
with `||` turns "set this to false" and "set this to 0" into "do not change this",
silently, across a whole multi-select. C1-06 pins the trap only where it appears in
`useListMutations`; this is the copy that reaches the server.

Expected Behavior:
`bulkSaveEntries(entries, { private: false })` sends `private: false`, and
`{ progress: 0 }` sends `progress: 0`.

Actual Behavior:
Unasserted. `src/api` has no test file.

Reproduction:
`ls src/api/*.test.*` → nothing.

Impact:
A bulk edit that appears to apply and does not, over an arbitrary number of
entries at once, with the optimistic cache patch (C1-06's half) showing the new
value until the next refetch. The user sees the change land and then revert.

Root Cause:
As C1-19 — no test file exists for the module.

Recommended Fix:
None to the code. Add the test to the `src/api/anilist.test.ts` proposed under
C1-19, mocking `@tauri-apps/api/core`'s `invoke` and asserting on the arguments.

Regression Tests Required:
In `src/api/anilist.test.ts`:
* `a_bulk_patch_sends_an_explicit_false_rather_than_dropping_it` — `vi.mock` the
  `invoke` used here; call `bulkSaveEntries` with `{ private: false }` and assert
  the payload's `private` is `false`, not `null`.
* `a_bulk_patch_sends_a_zero_progress` — `{ progress: 0 }` reaches the payload as
  `0`.
* `an_untouched_field_is_sent_as_null` — a patch touching only `status` sends
  `progress: null`, `private: null` and the rest, which is what the comment
  promises the Rust side.
* `a_score_is_converted_to_raw_before_it_is_sent` — with `scoreFormat = "POINT_5"`,
  `{ score: 4 }` reaches the payload as `scoreRaw: 80`, and an absent score as
  `null` rather than `0`. That covers the `patch.score !== undefined` ternary
  beside the `??` chain, which is a different guard for the same reason.

Confidence: HIGH
Source: found during adversarial verification.

---

ID: C1-09

Severity: P4

Category: MISSING TEST

File: /home/user/Karasu/src-tauri/src/anilist/auth.rs

Line: 390–402 (`#[cfg(all(test, windows))] mod dpapi_tests`), 560–599 (the Linux module)

Function: `dpapi_protect`, `dpapi_unprotect`, `save_token_file`, `load_token_file`

Problem:
Portable-mode token storage has a well-built Linux test module —
`a_sealed_token_round_trips`, `sealing_twice_does_not_repeat_itself`,
`a_tampered_or_foreign_file_is_rejected`,
`a_truncated_file_is_an_error_not_a_panic` — gated
`#[cfg(all(test, target_os = "linux"))]`. The Windows arm has one test where the
Linux arm has four, and `save_token_file`/`load_token_file` are untested on either
platform.

Expected Behavior:
The Windows DPAPI seam pins the same four properties the Linux one does, and the
file-level round trip is covered somewhere.

Actual Behavior:
`auth.rs:390–402` is `mod dpapi_tests` with a single `round_trip`, which protects
a token-shaped secret, asserts the ciphertext differs from the plaintext, and
asserts the round trip. No non-repetition case, no truncated or foreign-blob case.

Reproduction:
`grep -rn "cfg(all(test" src-tauri/src` →
```
src/anilist/auth.rs:390:#[cfg(all(test, windows))]
src/anilist/auth.rs:560:#[cfg(all(test, target_os = "linux"))]
```

Impact:
Thin. A DPAPI regression in portable mode signs the user out and is repaired by a
fresh sign-in; the missing cases are mostly assertions about
`CryptUnprotectData`'s own behaviour rather than about Karasu's. The
`save_token_file`/`load_token_file` gap is the more real half, since that code is
Karasu's and runs on both platforms.

Verification: downgraded from P2 — the finding's load-bearing evidence was false.
It claimed the Windows arm has "no test module at all" and that the grep returns
one hit; it returns two, and `mod dpapi_tests` compiles and runs on Windows,
including in CI, whose first job is `runs-on: windows-latest` running
`npm run verify` (ci.yml:20, :46). "Portable-mode token storage is fully untested
on Windows anywhere" is not the case.

Root Cause:
The Linux module was written alongside the XChaCha20 implementation and grew four
cases with it; the Windows module was written against the seam and grew one.

Recommended Fix:
Add the three missing cases to `mod dpapi_tests`. Optionally hoist the shared
cases into a `#[cfg(any(windows, target_os = "linux"))]` module written against
the `protect`/`unprotect` seam, so a third platform inherits them.

Regression Tests Required:
In `src-tauri/src/anilist/auth.rs`, `#[cfg(all(test, windows))]`:
* `protecting_twice_does_not_repeat_itself` — DPAPI output differs across calls.
* `a_truncated_blob_is_an_error_not_a_panic` — `unprotect(b"")` and
  `unprotect(b"garbage")` are `Err`.
* Platform-independent: `save_and_load_round_trip_through_a_temp_dir`, covering
  `save_token_file`/`load_token_file`, which neither platform tests today.

Confidence: HIGH

---

ID: C1-11

Severity: P4

Category: MISSING TEST

File: /home/user/Karasu/vitest.setup.ts

Line: 13–33 (the `react-i18next` mock)

Function: n/a

Problem:
The dom project stubs `t` to return `key` (or
`` `${key}:${JSON.stringify(vars)}` ``). The reasoning in the comment is sound —
assertions should pin *which* string a component chose, not what it currently
says. The class of bug it hides is named nowhere and nothing else covers it:
**interpolation-variable agreement**. A call site that supplies `{ minutes }` for
a template reading `{{n}}` renders `"Synced {{n}} min ago"` on screen, and both
guards miss it — `i18nKeys.test.ts` only checks that a key resolves to a string,
and `de: typeof en` only checks key structure, not placeholder names. A German
string whose placeholder was renamed in translation would render literally in
German and correctly in English.

Expected Behavior:
A test fails when a call site's variables do not cover its template's
placeholders, or when `de` and `en` disagree about placeholder names.

Actual Behavior:
No such test exists.

Reproduction:
Read `vitest.setup.ts:13–33` and `src/lib/i18nKeys.test.ts` — neither looks at
`{{…}}`.

Impact:
A raw `{{n}}` on screen is the same failure mode as a raw key, which is the
failure `i18nKeys.test.ts` was written for; the sibling half is unguarded.

Verification: downgraded from P3 — throwaway scans run in both passes agree the
tree is clean: **1,191 shared leaf keys between `en.ts` and `de.ts`, 0 placeholder
mismatches**, and 0 call sites missing an interpolation variable by a single-line
`t("key", { … })` regex. A guard against a bug class with zero instances, whose
worst outcome is a literal `{{n}}` on screen, is a nice-to-have.

Root Cause:
`i18nKeys.test.ts` was scoped to key existence.

Recommended Fix:
Extend `i18nKeys.test.ts` rather than adding a file — it already has the
raw-source glob and the `en` import.

Regression Tests Required:
In `src/lib/i18nKeys.test.ts`:
* `every_german_string_uses_the_same_placeholders_as_its_english_one` — walk both
  trees, compare the sorted `{{name}}` sets per leaf key, expect `[]` mismatches.
  Measured green today, twice.
* `every_interpolated_key_is_called_with_its_variables` — for each matched
  `t("key", { … })`, the template's placeholder set is a subset of the object's
  keys. Exempt keys reached only through a variable object (spread or multi-line)
  via an explicit list, same discipline as `DYNAMIC_PREFIXES`.

Confidence: HIGH

---

ID: C1-16

Severity: P4

Category: DEAD CODE

File: /home/user/Karasu/src-tauri/src/playback/detection/mod.rs

Line: 124–136

Function: `live_tests::live_detect`

Problem:
The one `#[ignore]`d test in the tree. It asserts nothing — it prints
`enumerate_windows()` and `detect_windows()` — and its doc comment is honest about
being a manual aid (`cargo test live_detect -- --ignored --nocapture`).

Whether it is worth keeping depends on the platform. On Windows, yes: it is the
only way to see what the Win32 enumerator sees, and window-title detection has no
other observable surface. On Linux it is misleading — `enumerate_windows` at
70–73 is a `#[cfg(not(windows))]` stub returning an empty vec, so the "manual live
test" prints nothing and reads as "detection is broken" rather than "this test
does not apply here". The `mod live_tests` block itself is `#[cfg(test)]` only,
not cfg-gated by platform.

Expected Behavior:
Either the module is `#[cfg(windows)]`, or its doc comment says it is
Windows-only.

Actual Behavior:
Neither.

Reproduction:
`cd src-tauri && cargo test live_detect -- --ignored --nocapture` on Linux prints
two empty results.

Impact:
Cosmetic and developer-facing only. Keep the test; it costs nothing and covers a
surface nothing else can.

Root Cause:
The module predates the `#[cfg(not(windows))]` stub.

Recommended Fix:
Add `#[cfg(windows)]` to `mod live_tests`, or one sentence to its doc comment
saying the Linux enumerator is a stub and this prints nothing there.

Regression Tests Required:
None — this is about a manual aid, not a guard.

Confidence: HIGH

---

ID: C1-21

Severity: P4

Category: BUG

File: /home/user/Karasu/src-tauri/src/commands/system.rs

Line: 689–690

Function: `tests::only_a_real_file_is_described`

Problem:
This is the only test in the Rust tree that temp-writes to a **fixed** shared path
and then deletes it:

```rust
let dir = std::env::temp_dir().join("karasu-portable-probe");
let _ = std::fs::remove_dir_all(&dir);
```

Every other temp-writing test keys the directory on something unique —
`db.rs:1773`, `:1968`, `:1994` and `library.rs:1889` use `std::process::id()`;
`logging.rs:710` and `:785` use `now_ms()`.

Expected Behavior:
Two `cargo test` runs on one machine do not interfere.

Actual Behavior:
They delete each other's directory mid-test. The second run's `remove_dir_all`
removes the first run's `karasu.db` between its
`std::fs::write(&db, b"SQLite format 3\0")` and its `describe_database(&db)`,
failing the `expect("the file is there now")`.

Reproduction:
Not reproduced on demand — it needs two concurrent runs. The hazard is read off
the path, and the divergence from every sibling test's convention is the evidence
that it is unintentional.

Impact:
A false failure in the one gate, under a plausible developer scenario: a local
`cargo test` beside a CI run on a self-hosted machine, or two target directories
built in parallel. Same "green by scheduling luck" family as C1-02, at much lower
frequency.

Root Cause:
The test was written without the uniqueness suffix its six siblings carry, and
the `remove_dir_all` that makes it self-cleaning is what turns the shared name
from harmless into destructive.

Recommended Fix:
`join(format!("karasu-portable-probe-{}", std::process::id()))`, matching
`db.rs`'s convention. One line.

Regression Tests Required:
None — this is a fix to an existing test. If the convention is worth enforcing,
a `grep`-shaped guard asserting that no `#[test]` builds a `temp_dir()` path
without a `process::id()` or `now_ms()` suffix would pin it, but that is a
lint rather than a test.

Confidence: HIGH on the divergence and the mechanism; the interference was not
staged.
Source: found during adversarial verification.

---

## Regression tests to add before release

Every P2-or-worse finding in this audit that has no test today, in the order they
should be written. The ranking is by consequence-if-it-recurs and by cost: the
first four are cheap and stop a broken gate or a defeated guard; the middle block
protects the code paths that write to a user's list; the last block is the
composition testing this report exists to argue for.

Findings whose defects were found by other passes are cited by their own IDs; the
report each comes from is named so the defect can be read in full.

### Tier 1 — the gate itself (do these first; everything else is measured through them)

| # | Test | File | Asserts | Catches |
|---|---|---|---|---|
| 1 | `a_second_panic_from_elsewhere_does_not_take_the_entry` | `src-tauri/src/logging.rs` | Install the hook, `catch_unwind` a panic with marker A, then one with marker B; A is still findable by its message | **C1-02** — the panic test finding `sync.rs:49`'s entry, which fails `npm run verify` on roughly half of parallel runs |
| 2 | (fix, not a new test) `the_ring_is_bounded_and_newest_first` filters `target == "ringtest"` | `src-tauri/src/logging.rs:683` | The newest *own* entry is first, and the ring is still capped | **C1-18** — the second copy of the same race, which C1-02's fix does not cover |
| 3 | (fix) `only_a_real_file_is_described` suffixes its temp dir with `process::id()` | `src-tauri/src/commands/system.rs:689` | Two concurrent runs do not share a directory | **C1-21** |

### Tier 2 — writes to the user's list

| # | Test | File | Asserts | Catches |
|---|---|---|---|---|
| 4 | `a_retryable_failure_aborts_the_drain_and_keeps_the_row` + `a_payload_anilist_refuses_is_dropped_rather_than_replayed_forever` | `src-tauri/src/commands/list.rs` (against an extracted `row_outcome`) | 429/5xx/`Invalid token`/network → `AbortDrain`; a 400 validation error → `Dropped` | **C1-04** — a misclassification either wedges the queue forever or silently discards a queued edit |
| 5 | `a_drain_reads_only_the_signed_in_account` | `src-tauri/src/db.rs` | Rows pushed for 111 and 222 with the cached viewer at 222: `queue_all(viewer_id)` returns 222's only | **C1-04** part 2, and the drain-side frontier of the v16 fix |
| 6 | `no_state_names_a_token_and_a_viewer_from_different_accounts` + a `process_queue` test refusing to drain when the token's owner ≠ `viewer_id(db)` | `src-tauri/src/commands/auth.rs`, `src-tauri/src/commands/list.rs` | `connect_with_token` leaves no window in which `load_token()` and `viewer_id()` disagree, including on a forced `kv_set` failure | **A1-01** (P2, `ACCOUNT_ISOLATION.md`) — the two unwound writes that let A's queued edits drain under B's bearer |
| 7 | `a_manual_save_updates_the_cache_the_scrobbler_reads` | `src-tauri/src/playback/scrobbler.rs` or `db.rs` | Seed `list_cache` with `progress: 4`, run a save setting 24, assert `candidates_from_cache` reports 24; and a `would_regress` case driven from the cache rather than a literal | **A1-03** (P2, `DATA_INTEGRITY.md`) — the two "never move backwards" guards read a cache no manual or bulk save updates |
| 8 | `a_deleted_entry_leaves_the_scrobble_cache` | `src-tauri/src/commands/list.rs`, `src-tauri/src/db.rs` | After `delete_list_entry` succeeds, `candidates_from_cache` no longer contains the media id | **A1-14** (P2, `DATA_INTEGRITY.md`) — playing a deleted title scrobbles it back into existence |
| 9 | `a_skipped_drain_queues_the_delete_instead_of_sending_it` + a shared test that all three mutating entry points take a non-live exit on `skipped` | `src-tauri/src/commands/list.rs` | With the drain lock held, `delete_list_entry` returns `MutationResult { queued: true, .. }` and issues no `DeleteMediaListEntry` | **A1-02** (P2, `DATA_INTEGRITY.md`) — a skipped drain treated as a successful one, letting a queued save recreate the entry |
| 10 | `an_identity_change_empties_the_query_cache` (dom) + `every_viewer_shaped_key_carries_a_viewer_id` (pure) | `src/stores/auth.dom.test.tsx`, new `src/lib/queryKeys.test.ts` | Seed `["mediaDetail", 1]` with `mediaListEntry.progress = 7`, `logout()` then sign in as another viewer, assert the data is gone; and that every key whose payload includes `mediaListEntry`, `isFavourite`, `isLiked`, `isFollowing` or `userRating` carries a viewer id or is on an explicit allowlist | **A3-01** (P1, `ACCOUNT_ISOLATION.md`) / **B4-01** (P2, `UI_UX_AUDIT.md`) — account A's list entry rendered under B, one Save away from writing there |
| 11 | `an_absent_field_is_left_alone` / `an_explicit_false_is_written` / `a_status_change_moves_the_entry_between_groups` / `a_bulk_patch_touches_only_the_selected_ids` | new `src/lib/listPatch.test.ts` (after extracting `applyInput`/`patchLists`) | `private: false` and `progress: 0` overwrite; the status-group move is correct | **C1-06** — the `??`-vs-`||` guard and the cache transform |
| 12 | `a_partial_bulk_failure_invalidates_instead_of_restoring` + `a_total_bulk_failure_restores_the_snapshot` | new `src/hooks/useListMutations.dom.test.tsx` | `BulkSaveError` with `updated: 3` invalidates and does not reset the cache; with `updated: 0` it restores | **C1-06** part 2 — the more dangerous of the two rollback branches |
| 13 | `a_bulk_patch_sends_an_explicit_false_rather_than_dropping_it` + `a_score_is_converted_to_raw_before_it_is_sent` | new `src/api/anilist.test.ts` | The `invoke` payload carries `private: false` and `progress: 0`, and `scoreRaw: 80` for `{ score: 4 }` at `POINT_5` | **C1-20** — the payload-side copy of the same `??` trap |

### Tier 3 — detection and scrobbling composition

| # | Test | File | Asserts | Catches |
|---|---|---|---|---|
| 14 | `a_pause_does_not_restart_the_threshold` — session armed at T, one/two/three ticks of `None`, then the same `(media_id, episode)`; plus `a_different_episode_after_the_gap_starts_fresh` and `a_long_absence_still_ends_the_session` | `src-tauri/src/playback/scrobbler.rs` | The remaining time is within a tick of what it was, not the full threshold | **B3-01** (P1, `DETECTION_AUDIT.md`) — one empty tick destroys the session, so an ordinary pause resets the wall-clock threshold on media-session-only players |
| 15 | `a_correction_beats_the_matcher` / `an_offset_lands_before_the_redirect` / `a_redirect_does_not_borrow_the_corrections_title` / `re_resolving_twice_does_not_shift_twice` / `clearing_a_correction_returns_the_matchers_guess` | `src-tauri/src/playback/scrobbler.rs` (against a `Db::open(tempdir)`, plus an extracted `resolve_correction`) | Correction before matcher; offset before redirect; `source_episode` is what a re-resolve reads | **C1-05** — the four composition rules CLAUDE.md calls load-bearing, duplicated 350 lines apart with nothing holding them together |
| 16 | `offsetFor` unit test, plus a Rust case pinning that a correction on a redirected match reproduces the same `(media_id, episode)` when the user changes nothing | new pure helper beside `NowPlayingCard.tsx`; `src-tauri/src/playback/scrobbler.rs` | `offsetFor(sourceEpisode, realEpisode)` is computed from the *source* episode, not the resolved one | **A2-01** (P2, `SCROBBLING_AUDIT.md`) — re-picking wipes a working offset and can destroy a redirect into a false `COMPLETED` |
| 17 | `is_armed_is_false_when_the_setting_is_off` | `src-tauri/src/playback/scrobbler.rs` (against an extracted `is_armed`) | `enabled = false` disarms `Watching` and an armed `EpisodeGap` alike — mirroring `a_gap_block_arms_only_when_opted_in_and_never_under_five_minutes`, which today tests only the arming side | **A2-02** (P2, `SCROBBLING_AUDIT.md`) — switching auto-update off mid-episode does not disarm the running session |
| 18 | `second_season_matches_correct_entry` extended with a season-1 candidate **before** the season-2 one, and again with the reverse ordering | `src-tauri/src/playback/recognition/matcher.rs:265` | 166531 is picked regardless of candidate order | **A2-04** (P2, `SCROBBLING_AUDIT.md`) — the season-stripped variant wins the exact-match short circuit; the existing test passes only because `candidates()` holds no season-1 Kusuriya entry |
| 19 | `every_season_spelling_reaches_the_same_entry` + `normalize_folds_case_and_punctuation` + `dice_is_the_dice_coefficient` | `src-tauri/src/playback/recognition/matcher.rs` | All four season spellings reach 166531 against a single season-2 title; the fold and the Dice `2.0 *` are pinned in the module that owns them | **C1-03** — deleting the `"Show 2"` spelling is invisible repo-wide, and the case fold's only guard lives in `identify.rs` |

### Tier 4 — network budget and availability

| # | Test | File | Asserts | Catches |
|---|---|---|---|---|
| 20 | `a_retry_after_park_blocks_the_preflight_check` / `max_pace_does_not_break_a_server_deadline` / `the_window_heal_does_not_outrun_a_retry_after` | `src-tauri/src/anilist/client.rs` | Parked `"retryAfter"` for 120 s with `remaining = 30` → the pre-flight decision is "wait", not "claim"; the 5 s escape fires for `"preflight"` and not for `"retryAfter"`; `headroom(t0 + 61 s)` is still 0 | **A3-02** / **PERF-03** (P2, `SYNC_AUDIT.md`, `PERFORMANCE.md`) — the `Retry-After` deadline is recorded and never consulted, and the window heal repairs the budget straight through it |
| 21 | `the_retry_predicate_refuses_a_surviving_rate_limit` (TS) + `a_retry_after_beyond_the_ceiling_yields_retryable` (Rust) | `src/app/main.tsx`'s predicate extracted to `src/lib/`, new test; `src-tauri/src/anilist/client.rs` | `false` for the rate-limit code, `true` for a generic network error; the sleep is clamped to the new ceiling | **A3-03** / **PERF-02** (P2) — two retry layers stacking to 4 requests and ~371 s with no cancellation |
| 22 | `drive_session_returns_within_one_poll_interval` + `a_second_tick_while_updating_starts_no_second_write` | `src-tauri/src/playback/scrobbler.rs` (needs a fake `perform_update` seam) | The poll loop is not held by an unresolved write; `applies_to` prevents a duplicate for the same `(media_id, episode)` | **A3-04** / **PERF-01** (P2) — the AniList write awaited inline in the 5 s detection loop, which can miss a short session entirely. Write both so they pass single-threaded, given C1-02 |
| 23 | `a_throttled_read_still_serves_the_cache` + `an_auth_error_still_propagates` + `a_retryable_error_with_no_cache_is_still_an_error` | `src-tauri/src/commands/list.rs` | `ApiError::Retryable` yields `ListResult { from_cache: true, .. }`; `ApiError::Auth` raises; an empty cache does not become an empty list | **A3-14** (P2, `SYNC_AUDIT.md`) — a 429 or rejected token shows the error page on every list screen despite a complete local cache |

### Tier 5 — the remaining P2 with no unit-testable seam

| # | Test | File | Asserts | Catches |
|---|---|---|---|---|
| 24 | `enable_portable_leaves_the_process_pointing_at_the_old_database` | `src-tauri/src/commands/system.rs` | The invariant is recorded in a test rather than only in prose — `enable_portable` does not repoint the live `Db` | **A4-02** (P2, `DATABASE_AUDIT.md`) — the toggle switches path resolution immediately while writes keep going to the old file, which the next launch will not open. The full fix (`app.restart()`) needs a live `AppHandle` and is not unit-testable; this pins the half that is |

### One test the whole set depends on

The SSRF guard (**C1-01**) is not in the tiers above because it is a code fix with
its tests already specified in the finding: six new spellings in
`local_and_private_hosts_are_refused`, plus
`a_public_address_in_mapped_form_is_still_allowed` so the fix is proven to be a
canonicalisation rather than a blanket ban on the `::ffff:` prefix, plus
`decimal_and_hex_host_spellings_normalise_before_the_guard` to pin the URL
parser's behaviour the guard silently relies on. It is the cheapest security fix
in the audit — one `to_ipv4_mapped()` call and a trailing-dot strip.

## Verified sound

Scenarios checked that **are** correctly handled, and the guard that handles each.

**Test infrastructure**

* **The node/dom vitest split is correctly filed in both directions.** The node
  project holds exactly one `.tsx` file, `src/components/stats/Charts.test.tsx`,
  and it genuinely needs no DOM — it uses `renderToStaticMarkup` and a regex over
  the markup and imports no Testing Library. All 18 `.dom.test.tsx` files use
  `@testing-library/react` or touch `document`/`window`; none is misfiled downward.
  The split is enforced by `include`/`exclude` in `vite.config.ts:47–64`, and
  `src/test/render.tsx`'s own comment states the constraint that keeps it honest
  (it imports Testing Library, so nothing in the node project may import it) — no
  node-project file does.
* **`vitest.setup.ts` is loaded by the dom project only** (`setupFiles` appears
  once, in the dom project block), so the `react-i18next`, `plugin-opener`,
  `@tauri-apps/api/event` and `ResizeObserver` stubs cannot leak into node tests.
* **Nothing in either suite touches the network.** No `msw`, no `nock`, no
  unmocked `fetch`; the one file matching a network grep (`threadJump.test.ts`)
  matched on the word "refetch" in a comment.
* **No skipped, `.only`, `.todo` or empty tests in the frontend suite.** The only
  matches for `skip` are `expect(out.skipped).toBe(n)` assertions in
  `jsonImport.test.ts` and `malImport.test.ts`. The Rust tree has exactly one
  `#[ignore]` (C1-16).
* **The frontend suite is timezone-independent.** All 935 tests were run under
  `TZ=Pacific/Kiritimati`, `TZ=Pacific/Midway` and `TZ=Europe/Berlin`; green in
  all three. The date-shaped suites (`calendar`, `ical`, `localStats`) pass
  explicit epochs rather than reading the clock, and only
  `SeasonHero.dom.test.tsx` uses fake timers.
* **The two frontend timing assertions have ~100× headroom.**
  `anilistHtml.test.ts:153` allows 4,000 ms and the block runs in 20 ms;
  `anilistMarkdown.test.ts:583` allows 5,000 ms and runs in 43 ms.
* **The Rust suite's one wall-clock assertion is not a flake risk.**
  `a_short_park_never_shortens_a_long_one` (client.rs:723–738) captures
  `Instant::now()` once, parks 120 s then 5 s and asserts more than 60 s remains —
  a 60-second margin across two adjacent statements. No failing schedule could be
  constructed and none was observed. (Recorded as refuted below.)

**Rust**

* **Offline-queue account isolation at the DB layer** —
  `a_queued_edit_is_invisible_to_another_account` (db.rs:2348) and
  `a_discard_only_removes_the_owners_row` (db.rs:2375). Both pin behaviour rather
  than implementation: the first asserts a third account sees an empty list *and*
  that `queue_len` agrees, closing the "empty-list fallback that would hide the
  distinction" its own comment names; the second asserts the negative case
  (`!queue_remove_for(222, id)` leaves the row) before the positive one, then the
  second-discard-returns-false case.
* **Migration V16's backfill and its DELETE** —
  `the_queue_migration_attributes_rows_to_the_cached_viewer` (db.rs:2393) and
  `the_queue_migration_drops_rows_it_cannot_attribute` (db.rs:2419) run the real
  `MIGRATION_V16` SQL against a real in-memory database, so they would catch a
  change to the `json_extract` path or the `WHERE user_id IS NULL` delete.
* **The half-migrated reopen** — `a_database_left_mid_upgrade_still_opens`
  (db.rs:1772) drives the real `Db::open` and walks all five
  `ALTER TABLE ADD COLUMN` guards (v7, v13, v14, v15, v16). It would fail if any
  `has_column` guard were removed. (Its three neighbours are C1-10.)
* **v17's two populations** —
  `v17_blurs_by_default_only_where_nothing_was_ever_stored` and
  `v17_leaves_an_explicit_choice_alone` (db.rs:1533, 1552) pin exactly the
  distinction the migration's comment says the key cannot make on its own.
* **`queue_key` / `queue_parts` identity** — nine tests (list.rs:1088–1188).
  `edits_to_different_fields_are_kept_apart` and
  `untouched_fields_do_not_join_the_key` pin the two *opposite* failure modes
  (swallowing a real edit vs. failing to dedupe), and
  `the_parts_and_the_key_describe_the_same_edit` pins the agreement between the
  sync panel and the dedupe that the shared `QueueParts` type exists for.
* **The scrobbler's data-safety rules** — `a_scrobble_can_only_ever_move_progress_forward`
  (six cases including `REPEATING` and `None`),
  `the_block_decision_names_which_way_it_went_wrong`,
  `a_season_the_matcher_could_not_use_blocks_before_anything_else` (the ordering:
  `UnknownSeason` before `AlreadyWatched`, and that a correction clears it),
  `a_season_spelled_in_the_title_is_left_alone`,
  `only_a_forward_force_or_a_retry_is_offered`,
  `a_gap_block_arms_only_when_opted_in_and_never_under_five_minutes` (seven cases
  including both negatives), `an_offset_moves_the_episode_and_never_below_one`,
  and the three `applies_to` tests. Each names the bug it guards.
* **The limiter's forward-only park** — `a_short_park_never_shortens_a_long_one`
  asserts both directions and that `sleeping_kind` follows the winning park, which
  is what the sync panel displays. `a_count_from_a_rolled_window_stops_counting`,
  `a_claim_is_visible_to_the_next_caller` and `claiming_past_empty_stops_at_zero`
  cover the sticky-nap bug, the in-flight claim and the `u32` underflow.
* **`scrub` per credential class** — five per-class tests (AniList bearer, OAuth
  redirect fragment, Jellyfin password, Jellyfin auth header *and* result, both
  sealed-token magics), plus `an_unrecognised_secret_shape_still_gets_redacted`
  for the catch-all, `ordinary_release_names_and_paths_survive` for the
  false-positive direction, and `no_secret_survives_to_the_file_on_disk`, which
  asserts against the artefact that actually leaves the machine rather than
  against the transform. That last one is the strongest test in the tree.
* **The `debug_changed` dedupe** — `a_repeated_line_is_recorded_once`,
  `a_value_returning_to_a_previous_one_is_still_a_change` (the flap case, which a
  "never seen" implementation would fail),
  `each_key_holds_one_entry_however_many_values_it_sees` (the unbounded-map leak)
  and `debug_changed_records_nothing_while_disabled`.
* **The updater comparator refusing an equal version** —
  `remote_is_newer_uses_the_running_commit_number` (update.rs:422) asserts the
  equal case *first* and by name, plus the no-build-metadata case that would
  otherwise loop. `can_install`'s
  `only_a_linux_build_outside_an_appimage_refuses_to_install` pins the exact
  inversion its doc comment warns about, and `non_numeric_tag_never_reports_an_update`
  pins the rolling-`latest` tag case. The *reader* side of the `+` spelling is
  fully covered; the writer side is C1-07.
* **anime-relations parsing and redirect** — six tests over a fixture that
  includes the open-ended range, the `!` self-redirect flag, the `~` same-id form
  and an unknown id, with both in-range and out-of-range episode assertions.
* **Portable-mode token crypto on Linux** — round trip, nonce non-repetition, AEAD
  tamper detection, wrong-key rejection, and four truncation shapes including a
  foreign magic. (The thinner Windows arm is C1-09.)
* **The Android Keystore token classifier** — `keystore.rs`'s four tests pin the
  legacy/sealed split including the bare-magic and short-file cases, which is the
  in-place-migration path CLAUDE.md describes.
* **`portable::data_dir` resolution** — five tests including the
  AppImage-beats-executable precedence and the "only an absolute existing AppImage
  is believed" guard.

**Frontend**

* **The content-filter *rule*** — `contentFilter.test.ts` covers `blockReason`'s
  adult-over-suggestive precedence and its "counts once" property, `isBlocked` at
  all three levels, case-insensitive genre matching, missing-field tolerance,
  `adultQueryArg`, `toLevel`'s default-to-strict, and `shouldBlur`'s "only ever
  veils isAdult, never a suggestive genre".
* **One application site of that rule** —
  `SeasonHero.dom.test.tsx:63–69` asserts a blocked title is absent from the
  rendered output, which is the pattern the other twenty surfaces need (C1-08).
* **The undo/receipt algebra** — `receipt.test.ts`'s 21 cases, including "undoes a
  change to zero, which is falsy but real", "clears a note that had none, rather
  than skipping it", "declines to undo a save that touched a whole-value field",
  and a round trip.
* **i18n key resolution in both directions** — `i18nKeys.test.ts` covers use→en
  (including the ternary form), en→dead-key, that the dynamic prefixes still point
  at real keys, and that the closed dynamic unions are complete. It guards itself
  with `expect(found.size).toBeGreaterThan(100)` so a broken glob cannot make it
  vacuous. The `de: typeof en` type covers en→de. Placeholder agreement is C1-11
  and measured clean.
* **The zustand selector-stability trap** — `auth.dom.test.tsx` counts renders
  rather than comparing references, which is the property a user experiences and
  the one that cannot be satisfied by accident.
* **`parseColumnCount`'s not-laid-out fallback** — including the
  `repeat(var(--cover-cols))` unset-token case that would otherwise collapse the
  grid. (The hook around it is C1-15.)
* **The case fold in `matcher::normalize` is pinned, incidentally** — by
  `identify.rs:216–224`'s `a_quote_in_a_title_cannot_escape_the_query`, which
  asserts `q.contains("kimi no na wa")` against `"Kimi \" no \" Na wa"`. Recorded
  here because it refutes the sharpest half of C1-03, and because the guard would
  vanish silently if that unrelated test were ever rewritten.

## Refuted during verification

* **C1-17 (wall-clock flake in `a_short_park_never_shortens_a_long_one`)** — filed
  as an investigation note rather than a defect, and closed negative in both
  passes: the test's 60-second margin spans two adjacent statements, no failing
  schedule could be constructed, and none was observed across nine parallel and
  three serial runs. Recorded above under "Verified sound".

## Counts

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 1 |
| P2 | 5 |
| P3 | 10 |
| P4 | 4 |
| **Total findings** | **20** |
| Refuted during verification | 1 |
