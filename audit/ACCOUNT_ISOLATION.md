# Account Isolation Audit

## Scope

This report answers one question: **can one account's data reach another account,
either on screen or as a write?** It covers the three identity transitions
(sign-in, sign-out, switch to local mode), what each one clears and what it
leaves behind, the v16 offline-queue scoping, and the drain's identity
resolution.

Files audited for this question, all at the audited commit:
`src-tauri/src/commands/auth.rs` (`connect_with_token`, `anilist_session`,
`anilist_logout`, `refresh_viewer`, `anilist_query`),
`src-tauri/src/commands/list.rs` (`viewer_id`, `pending`, `cached_media_list`,
`fetch_media_list`, `save_entry_core`, `delete_list_entry`, `enable_local_mode`,
`local_fetch_list`, `queue_push_deduped`, `process_queue`, `sync_status`,
`discard_queued_edit`), `src-tauri/src/db.rs` (kv, `list_cache`,
`offline_queue`, `notifications`, `MIGRATION_V16`),
`src-tauri/src/widgets.rs`, `src-tauri/src/playback/scrobbler.rs` (its reads of
the list cache), `src/stores/auth.ts`, `src/app/main.tsx`,
`src/api/anilist.ts`, `src/api/queries.ts`, `src/api/social.ts`,
`src/api/franchise.ts`, `src/pages/AnimeDetail.tsx`,
`src/pages/settings/AccountPane.tsx`, `src/hooks/useCachedEntry.ts`,
`src/hooks/useListMutations.ts`, `src/hooks/usePrimedLists.ts`,
`src/components/shell/Bell.tsx` and `src/components/shell/SyncPanel.tsx`.

Findings are drawn from the data-integrity and AniList-sync audits and their
adversarial verifications; every severity below is the verified one, and every
cell of the table that follows was re-read from source rather than copied from a
report.

## State cleared on sign-out

| Store | Cleared by `anilist_logout`? | Cleared by `enable_local_mode`? | Account-scoped key? | Consequence |
|---|---|---|---|---|
| OS credential store (access token) | **Yes** — `auth::delete_token()` (`commands/auth.rs:208`) | **Yes** — `crate::anilist::auth::delete_token()` (`commands/list.rs:580`) | **No** — one slot per install, carrying no account label | The bearer is the only thing that decides which account a write lands on, and nothing binds it to the identity the queue is scoped by. This is the root of A1-01. |
| `kv.anilist_viewer` | **Yes** — `db.kv_delete("anilist_viewer")` (`commands/auth.rs:209`) | **No** — the function writes `profile_mode` only (`commands/list.rs:579-582`) | It *is* the identity: `viewer_id` (`commands/list.rs:131-137`) reads `id` out of it | Local mode leaves the previous account's id in kv, and every queue read, write and count scopes on it (A1-09). |
| `kv.profile_mode` | **No** — `anilist_logout` never touches it, so it stays `"anilist"` (`commands/auth.rs:207-213`) | Set to `"local"`, not cleared (`commands/list.rs:581`) | No | Benign today: `anilist_query` only checks it to decide whether to attach a bearer (`commands/auth.rs:249-252`) and after a logout there is no token to attach, while the frontend maps anything but `"local"` to `"none"` (`src/stores/auth.ts:140-143`). It is also the third unwound write in `connect_with_token` (A1-16). |
| `offline_queue` | **No** — deliberate, and documented (`db.rs:305-321`, CLAUDE.md v16) | **No** | **Yes** — `user_id NOT NULL` on write (`db.rs:795-804`), filtered on every read (`db.rs:808-811`, `838-846`, `863-872`) | Correctly scoped; the rows survive a sign-out on purpose. But they are invisible and undrainable while signed out (A1-04), and in local mode they are counted against a stale identity (A1-09). |
| `list_cache` | **No** — nothing in the tree ever deletes a row; `cache_list` (`db.rs:682-698`) is the only writer and there is no `DELETE FROM list_cache` anywhere | **No** | Key is `PRIMARY KEY (user_id, media_type)` (`db.rs:27-33`), but the reader takes `user_id` from the frontend (`commands/list.rs:222-234`) | The signed-out account's whole collection — private entries, notes, scores — persists indefinitely with no purge, and is returned to any caller that asks with its id (A1-17, with A1-12). |
| `notifications` | **No** — no clear on any logout path (`notif_clear_kind` has one caller, `commands/update.rs:328`) | **No** | **No** — the table has no `user_id` (`db.rs:79-86`; v15 adds `media_id` only) | Locally generated airing/sequel/stale rows about the previous account's titles stay in the bell and are served unfiltered by `get_notifications` → `db.notif_all(100)` (`commands/system.rs:659-661`, `db.rs:1113`). |
| TanStack query cache | **No** — `logout` only `set()`s store fields (`src/stores/auth.ts:167-172`); the single `removeQueries` in the tree is scoped to `["social","forum","subscribed"]` (`src/pages/Thread.tsx:426`) | **No** — `enableLocal` clears nothing (`src/stores/auth.ts:161-165`) | Partly: `["mediaList", type, userId]` and the bell's `notifCount`/`siteNotifs` carry the viewer id; `mediaDetail`, `search`, `seasonal`, `recommendations`, `franchise` and the social keys do not | The previous account's `mediaListEntry` — status, progress, score, repeat and private `notes` — is rendered under the next account and can seed a write (A3-01). |
| `widgets.json` (Android only) | **Yes** — `crate::widgets::clear()` (`commands/auth.rs:212` → `widgets.rs:296-301`) | **No** | No — one file, projected from the viewer blob plus `list_cache` (`widgets.rs:204-219`) | Switching to local mode leaves the previous account's titles on the home screen; the projection is only rewritten from `fetch_media_list` (`commands/list.rs:283`), which local mode never calls. |

Read across the row for the token and the row for `kv.anilist_viewer`: those two
are the whole of the identity, they are written and deleted independently, and
nothing compares them at the point where a write goes out. That is the shape
every finding below is a face of.

## Findings at a glance

| ID | Severity | Category | File:Line | One-line summary |
|---|---|---|---|---|
| A3-01 | P1 | SECURITY RISK / DATA INTEGRITY RISK | `src/stores/auth.ts:149-172` | An identity change never clears the TanStack cache, so account A's list entry — including private notes — is rendered under B and one Save writes it to B's list. |
| A1-01 | P2 | DATA INTEGRITY RISK | `src-tauri/src/commands/auth.rs:155-160` | The token and the cached viewer are two unwound writes in the unsafe order, so a failing kv write leaves `token = B, viewer = A` and the drain sends A's queued edits under B's bearer. |
| A1-17 | P3 | DATA RETENTION / ACCOUNT ISOLATION | `src-tauri/src/commands/auth.rs:207-213` | `anilist_logout` clears the token, the viewer blob and the widget projection but never the signed-out account's cached lists, which no code path deletes. |
| A1-16 | P3 | BUG | `src-tauri/src/commands/auth.rs:160` | `profile_mode` is a third unwound write in `connect_with_token`: if it fails the install holds a valid session while Rust still believes it is in local mode. |
| A1-12 | P4 | IMPROVEMENT | `src-tauri/src/commands/list.rs:222-234` | `cached_media_list`/`fetch_media_list` take `user_id` from the frontend while the drain inside them scopes on the backend's `viewer_id`, and the two are never compared. |
| A1-09 | P4 | BUG | `src-tauri/src/commands/list.rs:579-582` | `enable_local_mode` deletes the token but leaves the viewer blob, so `SyncStatus.connected` is true in local mode and a stale identity keeps scoping the queue. |
| A1-04 | P4 | IMPROVEMENT | `src-tauri/src/commands/auth.rs:206-213` | The queue deliberately survives a sign-out, but every surface that could show it is scoped by the viewer blob the sign-out deletes, so the rows are invisible and undiscardable until the same account returns. |

---

ID: A3-01

Severity: P1

Category: SECURITY RISK / DATA INTEGRITY RISK

File: /home/user/Karasu/src/stores/auth.ts

Line: 149-158 (`connect`), 161-165 (`enableLocal`), 167-172 (`logout`), 128-134 (the `anilist-auth` listener)

Function: `useAuth.connect` / `useAuth.enableLocal` / `useAuth.logout`

Problem:
Signing out of one AniList account and into another — or into local mode — never
clears the TanStack Query cache, and a large set of cache keys carry
**viewer-relative** data without a viewer in the key. Account A's list entry
(progress, score, repeat and the private `notes` field) therefore remains in the
cache, is rendered under account B's session, and can seed a write.

`grep -rn "queryClient.clear\|qc.clear()\|removeQueries\|resetQueries" src/`
returns exactly one hit, `src/pages/Thread.tsx:426`, scoped to
`["social","forum","subscribed"]`. Nothing clears the cache on an identity
change; `src/components/overlays/SignInMerge.tsx:190` invalidates only
`["mediaList"]`.

The viewer-agnostic keys that carry viewer-relative payload:

| Key | Viewer-relative payload | Source |
|---|---|---|
| `["mediaDetail", mediaId]` | `mediaListEntry { id status progress score repeat notes }`, `isFavourite` | `src/api/queries.ts:44` in `MEDIA_FIELDS`, spread by `DETAIL_QUERY`; key at `src/pages/AnimeDetail.tsx:111` |
| `["search", type, term, …]` | `mediaListEntry {…}` | `src/api/queries.ts:66-70` |
| `["seasonal", …]`, `["seasonHero", …]` | `mediaListEntry {…}` | `src/api/queries.ts:95`, `:238` |
| `["recommendations", type, seedIds]` | `mediaListEntry {…}` per recommendation | `src/api/queries.ts:483-489` |
| `["libraryMedia", ids]`, `["librarySuggestedMedia", ids]` | `mediaListEntry {…}` | `src/api/queries.ts:430-435` |
| `["franchise", id]` | `mediaListEntry { status progress }` | `src/api/franchise.ts:28,42` |
| `["social","user", name]` | `isFollowing`, `isFollower` | `src/api/social.ts:175` |
| `["social","reviews", mediaId]` | `userRating` | `src/pages/AnimeDetail.tsx:838` |
| `["social","activities", userId]`, `["social","threadComments", threadId]` | `isLiked`, `isSubscribed` | `src/api/social.ts:340,874` |

The list keys themselves *are* scoped — `["mediaList", type, userId]`
(`src/hooks/useCachedEntry.ts:39`, `src/pages/MediaList.tsx:293`,
`src/pages/Dashboard.tsx:59,69`) — and the bell's `notifCount`/`siteNotifs`
carry `viewerId` (`src/components/shell/Bell.tsx:263,278`). The hole is
specifically the media, detail, search, franchise and social-graph keys.

Expected Behavior:
An identity change (sign out, sign in, switch to local mode) invalidates every
cached answer computed against the old bearer token, so nothing from the previous
account is rendered or used to seed a write.

Actual Behavior:
`staleTime` is 5 minutes and `gcTime` 30 minutes (`src/app/main.tsx:23-24`).
Within 5 minutes of an account switch `["mediaDetail", id]` is still **fresh**,
so `refetchOnMount` does not fire and the cached object is served verbatim.
`AnimeDetail` computes `const entry = data.mediaListEntry ?? cachedEntry`
(`src/pages/AnimeDetail.tsx:182`) and passes it as
`<ListEditor entry={entry ?? null}>` (`:485`). `ListEditor` seeds its controlled
state directly from that object (`:1411-1419` — `useState(entry?.status …)`,
`entry?.progress ?? 0`, `entry?.score ?? 0`, `entry?.repeat ?? 0`,
`parseNotes(entry?.notes)`), and its Save mutation sends all of them as absolute
values (`:1432-1444`). Between 5 and 30 minutes the entry is stale, so a refetch
is issued — but TanStack renders the cached data *while* it refetches, so the
previous account's numbers are on screen for the whole round trip and a Save
pressed in that window still sends them.

Nothing remounts on an identity change either: `src/app/App.tsx:193` keys
`<main>` on `pathname`, not on the viewer, and the callers of the store methods
(`src/pages/settings/AccountPane.tsx:107`, `:154`, `:213`) trigger no reload.

Reproduction:
1. Signed in as account A, open `/media/16498`, where A has `progress: 27`,
   `score: 9` and private text in `notes`.
2. Settings → Account → Sign out (`AccountPane.tsx:107`), then connect account B,
   which has never added that title.
3. Within five minutes navigate back to `/media/16498`.
4. The "My entry" card renders A's status, progress 27, score 9 and A's notes.
5. Press Save. `saveListEntry` posts `SaveMediaListEntry(mediaId: 16498,
   status: …, progress: 27, score: …, repeat: …, notes: "<A's private notes>")`
   with **B's** bearer (`commands/list.rs:375-383` → `save_entry_core`).

The search grid, the seasonal grid, the Dashboard strips and the franchise graph
show the same stale membership badges by the same mechanism.

Impact:
Account A's private `notes` text is displayed under account B's session, and a
single click writes A's progress, score, repeat and notes onto B's AniList list.
The same applies when switching *to* local mode: `enableLocal` clears nothing, and
`AnimeDetail.tsx:182`'s `data.mediaListEntry ?? cachedEntry` prefers the stale
AniList entry over the local one whenever the former is non-null. This is the
same class the v16 migration was written to close — closed on the SQLite side,
open on the query-cache side.

Root Cause:
The query cache has no notion of identity. The list keys were scoped to `userId`
(which is why they are safe), but every media/detail/social key was left
viewer-agnostic on the implicit assumption that its payload is public — and
`MEDIA_FIELDS` puts `mediaListEntry` into almost all of them.

Recommended Fix:
Clear the cache at the identity boundary. `logout`, `connect`, `enableLocal` and
the `anilist-auth` listener (`src/stores/auth.ts:128-134`) should each run
`queryClient.clear()`. The store cannot import the client without a cycle, so use
the registered-callback shape the module already uses for
`setTokenRejectedHandler` (`src/api/anilist.ts:63-66`): register a
`setIdentityChangedHandler` from `main.tsx`. Clearing rather than invalidating is
the right tool — invalidation leaves the stale object renderable during the
refetch, which is half the defect.

Regression Tests Required:
* A `.dom.test.tsx` that seeds `["mediaDetail", 1]` with
  `mediaListEntry { progress: 27 }`, calls `useAuth.getState().logout()` then
  `connect()`, and asserts `queryClient.getQueryData(["mediaDetail", 1])` is
  `undefined`.
* A unit test asserting the handler fires on all four identity transitions
  (`logout`, `connect`, `enableLocal`, the `anilist-auth` event).
* A guard test over `src/api/*.ts` asserting that any query key whose document
  contains `mediaListEntry`, `isFavourite`, `isLiked`, `isFollowing` or
  `userRating` either carries a viewer id or is on an explicit allowlist.

Confidence: HIGH

Verification: downgraded from P0 — the write is not automatic. `MediaCard`'s
one-click quick-add fires only when `entry` is null
(`src/components/media/MediaCard.tsx:109-135`), so the only path that sends
another account's numbers is a deliberate Save on the detail page or
`EntryEditModal`; the scrobbler reads progress from the account-scoped SQLite
list cache (`scrobbler.rs:727-733`), so no background write is affected; and the
list keys are scoped, so the list screens, the sidebar and Wrapped are clean.
Exposure needs a deliberate account switch, inside a 30-minute window, plus a
user click.

---

ID: A1-01

Severity: P2

Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src-tauri/src/commands/auth.rs

Line: 155-160

Function: `connect_with_token`

Problem:
`connect_with_token` writes the *token* and the *cached viewer* as two
independent, `?`-unwound steps, in that order:

```rust
155    auth::save_token(&token)?;                            // credential store -> B
157    db.kv_set("anilist_viewer", &viewer.to_string())?;    // SQLite          -> B
```

Nothing binds a stored token to the account whose rows the drain replays.
`process_queue` resolves the row owner from one store (`viewer_id(db)` →
`kv.anilist_viewer`, `commands/list.rs:913`) and receives the bearer from the
other (`auth::load_token()`, `commands/list.rs:248`, `381`, `452`, `522`,
`1076`), and never checks that the two agree (`commands/list.rs:916-943`).

Expected Behavior:
The queue's own invariant — a queued row is only ever written to the account that
made it (`db.rs:795-804`, `MIGRATION_V16` at `db.rs:305-330`) — should hold for
every reachable state of the two stores, not only for the states a *successful*
`connect_with_token` produces.

Actual Behavior:
If `db.kv_set("anilist_viewer", …)` at `auth.rs:157` fails, the `?` returns `Err`
**after** `auth::save_token` at line 155 has already succeeded. The install is
then left, persistently, in the state `token = B`, `kv.anilist_viewer = A`, and
that state survives a restart (`anilist_session` needs both, `auth.rs:199-204`).
From then on every drain — and the drain runs on every list mount,
`commands/list.rs:255` — does:

* `viewer_id(db)` → **A** (`list.rs:913`)
* `db.queue_all(A)` → A's unsynced edits (`list.rs:916`)
* `api.query(token, SAVE_MUTATION, …)` with **B's** bearer (`list.rs:939`)

`SaveMediaListEntry` is keyed on `mediaId` and writes to whichever account the
bearer names, so A's queued progress/status/score edits land on **B's** list and
are then deleted from the queue (`list.rs:940-943`). That is exactly the
cross-account write `MIGRATION_V16` exists to close, reached through a door the
migration does not cover.

Reproduction:
1. Sign in as A, go offline, make two list edits. `offline_queue` holds two rows
   with `user_id = A`.
2. Reach a state where a different account can be connected without a logout —
   a wiped credential store, or a rejected token
   (`src/components/shell/SessionExpired.tsx:26-50`); the pane's sign-in form is
   only rendered when the store's viewer is null (`AccountPane.tsx:88-112`).
3. Make the SQLite write at `auth.rs:157` fail (disk full, read-only data dir, or
   `SQLITE_BUSY` outliving the 5 s `busy_timeout` at `db.rs:521` — the Android
   background `JobScheduler` holding a second connection is called out as a real
   case at `db.rs:515-520`).
4. Sign in as B. `save_token` succeeds, `kv_set` fails, the command returns `Err`
   and the store keeps `viewer = A`.
5. Open any list. `fetch_media_list` → `process_queue` → A's rows go out under
   B's bearer.

Impact:
Cross-account write and silent corruption of a third party's list: one account's
unsynced edits are written to another AniList account and then removed from the
queue, so the loss is unrecoverable. No error is raised — the mutations succeed.

Root Cause:
The token and the account identity are two separate durable writes with no
transaction, no rollback and no cross-check at the point of use. The order is
also the unsafe one: token-then-viewer makes the intermediate state "new
credential, old identity", which is precisely the dangerous pairing.

Recommended Fix:
1. Reverse the order — write `anilist_viewer` (and `profile_mode`) *before*
   `auth::save_token`. The intermediate state becomes "new identity, old
   credential", for which `queue_all(B)` is empty and the drain is a no-op. If
   `save_token` then fails, delete the viewer blob so the install is signed out
   rather than mismatched.
2. Make the pairing checkable at the point of use: store the viewer id alongside
   the token and have `process_queue` refuse to drain when the token's owner and
   `user_id` differ. A queued row that cannot prove its owner matches the bearer
   should stay queued, not be sent.

Regression Tests Required:
* A Rust test that `connect_with_token` leaves no state in which `load_token()`
  and `viewer_id()` name different accounts, including on a forced `kv_set`
  failure (inject a read-only / failing `Db`).
* A `process_queue` test with a token whose owner ≠ `viewer_id(db)`: it must
  drain nothing and leave the queue intact.

Confidence: MEDIUM on reachability, HIGH on the mechanism

Verification: downgraded from P1 — the ordinary logout→login path is already
closed by v16 itself (`anilist_logout` deletes the blob at `auth.rs:209`, so
`viewer_id` is `None` and `process_queue` returns early, `list.rs:913-915`), and
the sign-in form is only reachable with a null store viewer. The trigger is
therefore a conjunction: queued rows for A, a re-sign-in as a different account
without a logout, and a failing `kv_set` in that exact call — a two-fault chain,
not a single fault.

---

ID: A1-17

Severity: P3

Category: DATA RETENTION / ACCOUNT ISOLATION

File: /home/user/Karasu/src-tauri/src/commands/auth.rs

Line: 206-213

Function: `anilist_logout` (with `db.rs:682-698` `cache_list`, `db.rs:744-752` `cached_list`, `commands/list.rs:222-234` `cached_media_list`)

Problem:
`anilist_logout` clears three things — the token, the cached viewer blob and the
Android widget projection — and names the reason for the third ("The widget
projection holds this account's titles and must not outlive it, exactly like the
token beside it", `auth.rs:210-211`). It does not clear the account's cached
lists, which hold far more of the same account's data than the widget projection
does.

Expected Behavior:
Signing out removes the account's data from local storage, or at minimum makes it
unreachable to any later caller. The comment at `auth.rs:210-211` states that
rule; `list_cache` is the largest thing it does not apply to.

Actual Behavior:
`list_cache` rows keyed `(user_id, media_type)` (`db.rs:27-33`) survive the
sign-out indefinitely. There is no delete path at all: `cache_list`
(`db.rs:682-698`) is the only writer, `cached_list` (`db.rs:744-752`) the only
reader, and no `DELETE FROM list_cache` exists anywhere in the tree — a row is
only ever overwritten by the same `(user_id, media_type)` pair. The payload is
the account's whole `MediaListCollection` including private entries, notes and
scores.

Combined with A1-12's missing ownership check, `cached_media_list`
(`commands/list.rs:222-234`) takes `user_id` from the caller and returns the
matching cached list plus that account's queue length, with no comparison against
`viewer_id(db)`.

Reproduction:
1. Sign in as A and open both list screens; `fetch_media_list` writes two
   `list_cache` rows for A (`commands/list.rs:283`).
2. Sign out. The token and the viewer blob go; the rows do not.
3. Inspect `karasu.db`: `SELECT user_id, length(payload) FROM list_cache` still
   reports A's two rows, and the payload contains A's `notes` and `private`
   entries.
4. Sign in as B and use the app; B's rows are added beside A's, which are never
   touched again. `invoke("cached_media_list", { userId: <A>, mediaType: "ANIME" })`
   returns A's full list.

Impact:
Data retention with no purge: a signed-out account's complete collection stays on
disk forever, which matters on a shared or handed-on machine, and there is no UI
that offers to remove it. It is also the payload behind A1-12 — the missing
ownership check has something worth handing out precisely because the sign-out
leaves it there. No live rendering path was found from the current frontend:
`usePrimedLists.ts:39`, `useCachedEntry.ts:39` and `useListSummary.ts:50` all
pass the store's `viewer.id`.

Root Cause:
Sign-out is implemented as "drop the credentials", not as "drop this account's
footprint". The widget projection was added to it by hand when it was written;
the list cache, which predates that, was never revisited.

Recommended Fix:
Delete the signed-out account's `list_cache` rows in `anilist_logout` (a
`DELETE FROM list_cache WHERE user_id = ?` beside the `kv_delete`, resolving the
id before the blob is removed), or — if keeping them for a fast re-sign-in is
wanted — gate the read on ownership per A1-12 and offer an explicit purge in
Settings → Advanced. Doing both is cheapest to reason about.

Regression Tests Required:
* A Rust test that after `anilist_logout` no `list_cache` row remains for the
  account that was signed in.
* A test that `cached_media_list` with a `user_id` that is not the cached viewer
  returns nothing (shared with A1-12).

Confidence: HIGH that the rows survive and that nothing deletes them; no live
frontend path found that reads another account's row.

Source: found during adversarial verification

---

ID: A1-16

Severity: P3

Category: BUG

File: /home/user/Karasu/src-tauri/src/commands/auth.rs

Line: 160

Function: `connect_with_token`

Problem:
`connect_with_token` makes three durable writes in a row, none of them rolled
back: the token (`:155`), the viewer blob (`:157`) and
`db.kv_set("profile_mode", "anilist")` (`:160`). A1-01 covers a failure of the
second. The third has its own failure mode, and it is not the same one.

Expected Behavior:
A connect either establishes all three facts that make up "signed in to AniList"
— credential, identity, active profile — or leaves none of them behind.

Actual Behavior:
If the write at `:160` fails after the first two landed, the install holds a
valid token and a valid viewer blob for the new account while `profile_mode`
still reads `"local"` (the value the previous local-mode session wrote;
`profile_mode` defaults to `"anilist"` when absent, `commands/list.rs:556-559`,
so this needs a prior explicit local mode — which is the ordinary "tried it
without an account first" upgrade path). In that state:

* `anilist_query` deliberately withholds the bearer
  (`commands/auth.rs:249-252`), so every AniList read runs unauthenticated;
* `fetchMediaList` routes to `local_fetch_list`
  (`src/api/anilist.ts:129-134`), which reports `pending: 0`
  (`commands/list.rs:594-598`) and never calls `process_queue`, so any rows
  queued for that account stall invisibly;
* `connect_with_token` returned `Err`, so the frontend reports a failed sign-in
  (`AccountPane.tsx:154`) while the credential store holds a working token.

Reproduction:
1. Choose "Use without an account" so `profile_mode = "local"`.
2. Make the third `kv_set` fail while the first two succeed (a disk that fills
   between the two writes, or `SQLITE_BUSY` outliving the 5 s `busy_timeout`
   after the viewer write took the lock once already).
3. Sign in to AniList. The pane shows an error; restart the app. `anilist_session`
   now returns the viewer (token + blob are both present) so the store shows the
   account, while `profile_mode` is still `"local"` and every list read is served
   from the local list.

Impact:
An install that believes it is in local mode while holding a live session for a
real account: lists do not load from AniList, queued edits never drain, and
nothing on screen explains why. No cross-account write results — the withheld
bearer is what prevents it — so this is a stuck-state defect rather than a
leakage one.

Root Cause:
The same as A1-01: three independent durable writes with no transaction and no
rollback, in a function whose contract is all-or-nothing.

Recommended Fix:
Write the two kv values in one transaction (or via a single helper that sets both
and rolls back together), and order the whole sequence identity-then-credential
per A1-01's fix so a partial failure always lands on "signed out" rather than on
a half-state.

Regression Tests Required:
A Rust test that a forced failure of the `profile_mode` write leaves the install
in a coherent state — either fully connected or fully signed out — and never
`profile_mode = "local"` with a loadable token and viewer blob.

Confidence: HIGH on the mechanism (three bare `?` writes in sequence); MEDIUM on
reachability, since it needs the third write alone to fail.

Source: found during adversarial verification

---

ID: A1-12

Severity: P4

Category: IMPROVEMENT

File: /home/user/Karasu/src-tauri/src/commands/list.rs

Line: 222-234 and 240-309

Function: `cached_media_list` / `fetch_media_list`

Problem:
Both commands take `user_id` from the frontend and use it for the cache key
(`db.cached_list` / `db.cache_list`) and for the pending count
(`db.queue_len(user_id)`, `list.rs:231`, `287`, `302`), while the drain running
inside `fetch_media_list` scopes itself on the *backend's* `viewer_id(db)`
(`list.rs:913`). The two are never compared.

Expected Behavior:
The account a list result describes, and the account whose queue it drains and
counts, should be provably the same.

Actual Behavior:
They are the same only because the auth store always passes `viewer.id`
(`useListSummary.ts:50`, `usePrimedLists.ts:39`, `useManualSync.ts:43`,
`SignInMerge.tsx:70`). Nothing enforces it. A stale `viewer.id` in the store — or
any future caller passing a different id — would make `ListResult.pending` count
one account's rows while the drain sends another's, and `cached_media_list` will
return any account's cached list and queue length for the asking. Because nothing
ever deletes a `list_cache` row (A1-17), the rows to hand out are always there.

Reproduction:
No reproduction from the current UI; the invariant is simply unenforced. From the
IPC boundary, `invoke("cached_media_list", { userId: <any previously cached
account>, mediaType: "ANIME" })` returns that account's list.

Impact:
No live defect found. It is a missing invariant on the boundary that A1-01 shows
is load-bearing, and the read half of A1-17.

Root Cause:
The command's identity parameter and the backend's identity source are
independent values with no relation asserted between them.

Recommended Fix:
Either derive `user_id` from `viewer_id(&db)` inside the commands and drop the
parameter, or reject the call when `Some(user_id) != viewer_id(&db)`.

Regression Tests Required:
A test that `fetch_media_list` and `cached_media_list` with a `user_id` that is
not the cached viewer are refused (or ignored in favour of the cached one).

Confidence: HIGH that the check is absent; no exploit path found from the current
frontend.

---

ID: A1-09

Severity: P4

Category: BUG

File: /home/user/Karasu/src-tauri/src/commands/list.rs

Line: 579-582 (with 131-137 and 1024-1054)

Function: `enable_local_mode` / `viewer_id` / `sync_status`

Problem:
`SyncStatus.connected` is documented as *"Signed in to AniList. False in local
mode, where nothing syncs by design and an empty queue is not the same
statement."* (`list.rs:1009-1011`). It is computed as `viewer.is_some()` where
`viewer = viewer_id(&db)` (`list.rs:1029`, `1048`) — i.e. "a `kv.anilist_viewer`
blob exists". It consults neither `profile_mode` nor the token.
`enable_local_mode` deletes the token and sets `profile_mode = "local"` but
leaves the viewer blob in place:

```rust
579    pub fn enable_local_mode(db: State<'_, Db>) -> Result<(), String> {
580        crate::anilist::auth::delete_token();
581        db.kv_set("profile_mode", "local")
582    }
```

Expected Behavior:
`connected` should mean what its doc says. `syncPhase` returns `"offline"` for
`!connected` first and separately, explicitly so local mode cannot be collapsed
with a signed-in account (`src/lib/syncQueue.ts:19-31`).

Actual Behavior:
In the reachable state "viewer blob present, no token, `profile_mode = local`":
`sync_status.connected` is `true`; `syncPhase` returns `"waiting"` rather than
`"offline"`; `pending(db)` counts the stale account's rows (`list.rs:139-141`);
and `flush_queue` cannot drain them — it requires a token and returns
`"Not connected to AniList"` (`list.rs:1076`) — while no other drain runs,
because local mode routes list reads to `local_fetch_list`
(`src/api/anilist.ts:129-134`), which never calls `process_queue` and hardcodes
`pending: 0` (`list.rs:594-598`).

That state is reachable whenever the token disappears without a logout (a locked
Secret Service on Linux, a wiped credential store, the reinstall case
`enable_local_mode`'s own comment describes at `list.rs:568-577`): the auth store
then shows `viewer = null` because `anilist_session` needs both a token *and* the
blob (`auth.rs:199-204`), so the "Use without an account" button becomes
reachable (`AccountPane.tsx:203-218`, `FirstRun.tsx:78`) while the blob is still
in kv. The same leftover blob is what keeps the Android widget projection
attributable after the switch (`widgets.rs:204-213`).

Reproduction:
1. Sign in as A; make an offline edit so the queue holds a row for A.
2. Remove the token without a logout (wipe the credential store / lock the
   keyring), restart. The app presents as signed out; `kv.anilist_viewer` is
   still A.
3. Press "Use without an account". `enable_local_mode` sets `profile_mode` and
   deletes an already-absent token; the blob stays.
4. `sync_status` now reports `connected: true` with A's queued row listed, and
   nothing in the app can drain or discard it.

Impact:
Limited today, because the two surfaces that would show the wrong value gate on
the *store's* mode rather than on `connected` (`Sidebar.tsx:236-266` hides the
panel in local mode; `AdvancedPane.tsx:1035-1041` refuses). So the wrong
`connected` is masked by its callers rather than by the value, and the queue rows
are counted, undrainable and undiscardable in that state.

Root Cause:
`connected` is derived from one of the three facts that make up "signed in"
(the cached viewer) and not the other two (token, profile mode); and
`enable_local_mode` clears one of those three (the token) but not the identity.

Recommended Fix:
Compute `connected` as
`profile_mode(&db) == "anilist" && viewer_id(&db).is_some()` (and, to be strictly
honest, `auth::load_token().is_some()`), and have `enable_local_mode` clear
`anilist_viewer` the way `anilist_logout` does (`auth.rs:209`) so no stale
identity is left scoping the queue. Clearing the blob there also stops the
widget projection from outliving the account on Android.

Regression Tests Required:
A Rust test: with `profile_mode = "local"` and a viewer blob present,
`sync_status().connected` must be `false`; and a test that `enable_local_mode`
leaves no `anilist_viewer` blob.

Confidence: HIGH for the code (the three reads are direct); no live user-visible
defect, since both consuming surfaces gate on the store's mode.

Verification: downgraded from P3 — the report concedes there is no live
user-visible defect and both surfaces that could show the wrong value gate on the
store's mode instead, which makes this a latent invariant.

---

ID: A1-04

Severity: P4

Category: IMPROVEMENT

File: /home/user/Karasu/src-tauri/src/commands/auth.rs

Line: 206-213 (with `commands/list.rs:139-141`, `1029-1048`)

Function: `anilist_logout`

Problem:
Keeping the queue across a sign-out is a documented decision (`db.rs:305-321`,
CLAUDE.md v16), and the scoping that makes it safe holds. Its visibility
consequence is not documented and has no guard: every queue surface is scoped
through `viewer_id(db)`, which reads the viewer blob `anilist_logout` has just
deleted (`auth.rs:209`).

* `pending(db)` → `viewer_id(db).map_or(0, …)` → **0** (`list.rs:139-141`), so
  the sidebar badge and `ListResult.pending` say nothing.
* `sync_status` → `viewer = None` → `queued: []`, `connected: false`
  (`list.rs:1029-1048`), so the panel lists nothing.
* `QueueSection` in Settings → Advanced renders `NeedsAccount` when
  `mode !== "anilist" || !viewer` (`AdvancedPane.tsx:1035-1043`), hiding the
  per-row discard entirely.

Expected Behavior:
An unsynced edit that the app has deliberately retained should remain visible to
its owner, and discardable, in the state where it is being retained.

Actual Behavior:
The rows sit in SQLite, correctly attributed, with no surface that will show or
discard them until the same account signs back in — at which point the first list
mount drains them (`list.rs:255`) with absolute payloads and no age check
(`list.rs:939-943`), even though `created_at` has been stored since the table
existed (`db.rs:401-416`) and is read only for the panel's "queued N minutes ago"
label (`list.rs:1041`).

Reproduction:
1. Signed in as A, offline: mark a series `COMPLETED, progress 24`. One row
   queued with `user_id = A`.
2. Sign out. Token and viewer deleted (`auth.rs:208-209`); the row stays.
3. Sidebar shows nothing (`Sidebar.tsx:236`), the Advanced pane refuses,
   `sync_status` returns an empty queue. There is no way to see, export or
   discard the row.
4. Sign in as A again; the row drains on the first list mount.

Impact:
An observability gap in a deliberately retained store: the user cannot audit or
discard their own pending writes while signed out. No cross-account element —
the v16 scoping holds throughout, and the rows replay onto their own account.

Root Cause:
The queue's visibility, its owner scoping and its replay trigger are all keyed on
the same value (`kv.anilist_viewer`), which sign-out deletes. Scoping needs that;
visibility does not.

Recommended Fix:
Show the retained rows while signed out: `sync_status` and the Advanced pane's
`QueueSection` can read the whole table (`SELECT … GROUP BY user_id`) and label
rows as belonging to a signed-out account, with discard scoped by the row's own
`user_id` — `queue_remove_for` already takes it (`db.rs:838-846`). At minimum,
say so at the logout confirm, so signing out with a non-empty queue is an
informed choice.

Regression Tests Required:
A test that a queue row survives `anilist_logout` **and** is reported by whatever
the new signed-out surface is, so the invisibility cannot come back.

Confidence: HIGH (each step is a direct read of the cited code)

Verification: downgraded from P2 — the second half of the original finding
("replayed with no age bound over newer server state") is what an offline queue
*is*, and is the documented v16 decision; the same overwrite happens to a user
who is merely offline for a month. The rows replay onto their own account, so
nothing crosses accounts, and what remains is an observability gap.

---

## Verified sound

Scenarios worked through against the code that are handled correctly, each with
the guard that handles it.

1. **A signs out, B signs in, B's first list fetch drains — no cross-account
   write on the normal path.** `process_queue` resolves the owner from
   `viewer_id(db)` *inside* the lock and reads only that owner's rows
   (`list.rs:911-916`); `queue_all`/`queue_len` filter on `user_id` with no
   empty-list fallback (`db.rs:808-811`, `863-872`). Pinned by
   `a_queued_edit_is_invisible_to_another_account` (`db.rs:2347-2369`). A's rows
   are left untouched and drain when A signs back in. (The one hole is A1-01's
   mismatched token/viewer state, a different mechanism.)
2. **Signed out, there is nothing to drain.** `viewer_id` returns `None` and
   `process_queue` returns early with `skipped: false` (`list.rs:913-915`), so a
   drain with a foreign or absent token cannot send anything.
3. **A queued row can never be ownerless.** `queue_push_deduped` refuses without a
   viewer (`list.rs:826`) and `Db::queue_push` takes a non-optional `user_id`
   (`db.rs:795`), so the v16 shape is unwritable rather than merely unwritten;
   every caller propagates the refusal to the UI (`list.rs:350`, `361`, `529`,
   `538`).
4. **A user-triggered discard cannot delete another account's row.**
   `discard_queued_edit` resolves the owner in Rust and puts it in the WHERE
   clause (`list.rs:1063-1067` → `db.queue_remove_for`, `db.rs:838-846`), never
   trusting the UI-supplied id — which matters because that id comes from a
   snapshot that can straddle a sign-out. Pinned by
   `a_discard_only_removes_the_owners_row` (`db.rs:2375-2387`).
5. **The v16 backfill and its drop rule.** Attribution to the cached viewer and
   deletion of unattributable rows are both pinned (`db.rs:2392-2413`,
   `2418-2434`), and the step carries the `has_column` guard plus `apply`'s
   transaction so the column and the attribution land together (`db.rs:602-613`,
   `493-496`).
6. **The list query keys are account-scoped.** `["mediaList", type, userId]`
   (`useCachedEntry.ts:39`, `useListSummary.ts:49`, `MediaList.tsx:293`,
   `Dashboard.tsx:59,69`, `Calendar.tsx:98`, `LocalLibrary.tsx:122`), so the list
   screens, the sidebar summary and Wrapped cannot render another account's list
   even with the cache uncleared. The bell's `notifCount`/`siteNotifs` keys carry
   `viewerId` the same way (`Bell.tsx:263,278`).
7. **A stale token cannot poison public queries in local mode.** `anilist_query`
   sends no bearer when `profile_mode == "local"`, whatever the credential store
   still holds (`auth.rs:245-252`) — the second half of `enable_local_mode`'s own
   documented fix for a token surviving a reinstall.
8. **The widget projection does not outlive the account on the logout path.**
   `anilist_logout` calls `crate::widgets::clear()` (`auth.rs:212` →
   `widgets.rs:296-301`), and `write_projection` returns early with no viewer blob
   (`widgets.rs:207-213`). (The local-mode path is the gap, noted in the table.)
9. **The sign-in merge cannot cross accounts.** It refuses to run against a cached
   list (`SignInMerge.tsx:70-75`), clears a local row only after a non-queued push
   (`:150-155`, `:171-176`), and writes with the freshly connected account's own
   token through `save_list_entry`; local scores are pinned to `POINT_10` on
   conversion (`api/anilist.ts:326-329`).
10. **Crash mid-drain cannot double-apply, and a replay cannot land a relative
    value on the wrong account's numbers.** `db.queue_remove(id)` runs only on
    `Ok(_)` from the server (`list.rs:940-943`), and every payload is absolute —
    `progress` is computed client-side into a final number (`Dashboard.tsx:218`),
    the editor sends absolute `status/progress/score/repeat/notes`
    (`EntryEditModal.tsx:437-450`), the scrobbler sends `{"progress": episode}`
    (`scrobbler.rs:751`), and scores go as `scoreRaw` (`api/anilist.ts:115-122`).
11. **Retryable vs. permanent classification protects the queue across a token
    change.** `classify`/`is_retryable` keep a row for offline, 429, 401/403 and
    5xx (`anilist/client.rs:103-175`) and `process_queue` aborts the whole drain
    rather than dropping (`list.rs:944`); only an `Api` rejection removes a row,
    and that removal is reported through the bell (`report_dropped`,
    `list.rs:959-976`).
12. **Drain re-entrancy.** `DRAIN.try_lock` guarantees one drain process-wide and
    skips rather than blocking (`list.rs:862`, `905-907`); `DrainMark`'s `Drop`
    clears `DRAINING` on all three exits including a panic (`list.rs:878-891`).
13. **The scrobbler's identity is the backend's, not the frontend's.** It reads
    candidates from the SQLite list cache scoped by the cached viewer
    (`scrobbler.rs:263-272`, `727-737`), so no background write can be aimed at an
    account by a stale value in the WebView.

## Refuted during verification

* **A1-13 — "`queue_push_deduped` refuses with no viewer, so a scrobble is lost
  silently."** Claimed that in the state "token present, viewer blob absent" an
  offline scrobble is dropped with only a log line. Not a defect: both call sites
  turn the `Err` from `perform_update` into
  `Phase::Blocked(BlockReason::Failed { message })` and emit it to the now-playing
  surface (`scrobbler.rs:983-994`, `1224-1236`), so the user sees the failure on
  the card; and the precondition is near-unreachable, because `anilist_session`
  needs both the token and the blob (`auth.rs:199-204`) and the app presents as
  signed out otherwise. The refusal itself is the correct behaviour (see Verified
  sound #3).

## Counts

| Severity | Count |
|---|---:|
| P0 | 0 |
| P1 | 1 |
| P2 | 1 |
| P3 | 2 |
| P4 | 3 |
| **Total findings** | **7** |
| Refuted during verification | 1 |

Two of the seven (A1-16, A1-17) were found during adversarial verification rather
than in the original passes; they are numbered by their position in the
verifier's missed-issue list, continuing the A1 series, so the ids stay stable
across the sibling reports.
