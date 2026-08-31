# UI and UX Audit

## Scope

This report covers the user-facing half of the frontend: settings controls and
whether they actually reach the backend, states that misreport success or never
resolve, content-filter coverage across every surface that can render a title,
i18n correctness, routing, overlays, keyboard behaviour and accessibility.
Audited read-only at working-tree `9a53427`; no repository file was modified.

Source files read for this report:
`src/stores/auth.ts`, `src/stores/contentFilter.ts`, `src/app/App.tsx`,
`src/app/main.tsx`, `src/api/social.ts`, `src/api/queries.ts`,
`src/lib/contentFilter.ts`, `src/lib/i18nKeys.test.ts`,
`src/hooks/useGridRoving.ts`, `src/hooks/useManualSync.ts`,
`src/components/shell/Bell.tsx`, `src/components/shell/CommandPalette.tsx`,
`src/components/media/MediaCard.tsx`, `src/components/social/ActivityCard.tsx`,
`src/components/overlays/MatchPicker.tsx`,
`src/components/overlays/SeasonSplitModal.tsx`,
`src/components/overlays/FavouritesModal.tsx`,
`src/pages/Calendar.tsx`, `src/pages/Dashboard.tsx`, `src/pages/LocalLibrary.tsx`,
`src/pages/Search.tsx`, `src/pages/Seasonal.tsx`, `src/pages/AnimeDetail.tsx`,
`src/pages/About.tsx`, `src/pages/Wrapped.tsx`,
`src/pages/settings/AdvancedPane.tsx`, `src/pages/settings/AniListPane.tsx`,
`src/pages/settings/IntegrationsPane.tsx`, `src/i18n/en.ts`, `src/i18n/de.ts`,
cross-checked against `src-tauri/src/commands/{update,prefs,list,auth}.rs` and
`src-tauri/src/alerts/{airing,sequel,stale,notify}.rs` wherever the frontend
makes a claim about the backend.

IDs carry the `B4-` prefix of the frontend pass and share the numbering with the
sibling reports. Every severity below is the one the adversarial verification
returned, not the one originally filed; where the two differ the finding carries
a `Verification:` line on its Confidence entry. Findings numbered `B4-16` and
above were raised by the verification pass itself.

Purely performance-shaped findings from the same pass — unvirtualized rendering,
listener and timer lifecycle, cache growth, refetch volume — belong to
`PERFORMANCE.md`; see **See also** at the end.

## Findings at a glance

| ID | Severity | Category | File:Line | One-line summary |
|---|---|---|---|---|
| B4-01 | P2 | DATA INTEGRITY RISK | `src/stores/auth.ts:167` | `logout()` never clears the TanStack cache, so six viewer-blind keys render account A's list entry under account B and can seed a write |
| B4-03 | P3 | BUG | `src/api/social.ts:1458` | The bell's AniList notification rows carry no `isAdult`/`genres`, so the content filter cannot be applied to them at all |
| B4-06 | P3 | BUG | `src/pages/Calendar.tsx:348` | `blur_adult` is honoured on eight cover surfaces and silently skipped on five |
| B4-07 | P3 | BUG | `src/hooks/useGridRoving.ts:112` | The roving grid cursor never scrolls its card into view on Search and Seasonal |
| B4-09 | P3 | BUG | `src/pages/Dashboard.tsx:329` | "1 episodes across 1 shows air this week" — the one count string with no singular form |
| B4-16 | P3 | BUG | `src/components/media/MediaCard.tsx:50` | The save handler mutates TanStack-owned query data in place, so no other observer of the page re-renders |
| B4-04 | P4 | BUG | `src/components/shell/Bell.tsx:430` | Stored Karasu notification rows are filtered at write time only and are never re-checked at render |
| B4-05 | P4 | BUG | `src/components/overlays/MatchPicker.tsx:113` | The match picker and season-split search omit the `isAdult` server argument and trim the page on arrival instead |
| B4-08 | P4 | BUG | `src/pages/settings/AdvancedPane.tsx:838` | Four settings controls paint optimistically with no rollback and no error surface |
| B4-11 | P4 | IMPROVEMENT | `src/app/App.tsx:193` | No scroll restoration anywhere; `<main>` is keyed on the pathname so every navigation lands at the top |
| B4-12 | P4 | CODE SMELL | `src/stores/auth.ts:128` | `auth.init` registers a Tauri listener with no idempotency guard and no unlisten handle |
| B4-13 | P4 | DOCUMENTATION ISSUE | `src/lib/i18nKeys.test.ts:52` | A comment names `i18nFamilies.test.ts`, which does not exist |
| B4-15 | P4 | IMPROVEMENT | `src/hooks/useGridRoving.ts:69` | The roving cursor is drawn, not focused: no `aria-activedescendant`, no grid roles |
| B4-17 | P4 | CODE SMELL | `src/pages/AnimeDetail.tsx:1447` | Three bare 2 s `setTimeout`s write state with no cleanup, contradicting the pass's own "every timer clears" claim |
| B4-18 | P4 | CODE SMELL | `src/hooks/useGridRoving.ts:52` | A ref is written during render in the one hook StrictMode double-renders on every keypress |
| B4-19 | P4 | CODE SMELL | `src/components/overlays/MatchPicker.tsx:113` | Two search query keys omit `level`, so one key holds pages trimmed under different filter levels |

---

ID: B4-01
Severity: P2
Category: DATA INTEGRITY RISK

File: /home/user/Karasu/src/stores/auth.ts
Line: 167-172, with the consuming keys at /home/user/Karasu/src/pages/AnimeDetail.tsx:110, /home/user/Karasu/src/pages/Seasonal.tsx:59, /home/user/Karasu/src/pages/Search.tsx:209, /home/user/Karasu/src/pages/Franchise.tsx:74, /home/user/Karasu/src/components/media/RecommendedSection.tsx:79
Function: `useAuth.logout`

Problem:
`logout()` clears the Rust-side token and the in-memory viewer and touches nothing
else. Several query keys carry viewer-specific payloads and are not keyed by the
viewer id, so an account switch inside one session serves account A's private list
data to account B — and, through `EntryEditModal`, can write A's numbers onto B's
list.

```ts
// src/stores/auth.ts:167
logout: async () => {
  await api.logout();
  set({ viewer: applyViewer(null), mode: applyMode("none"), sessionExpired: false });
},
```

There is no `queryClient.clear()`, `removeQueries` or `resetQueries` anywhere in
`src/` — the only hit is `Thread.tsx:426`, which removes one forum key on unmount.
`connect()` (`auth.ts:149`) and the `anilist-auth` listener (`auth.ts:128`) do not
clear it either, and neither path reloads the WebView. Rust does not compensate:
`anilist_logout` (`src-tauri/src/commands/auth.rs:207-213`) deletes the token, the
cached viewer and the widget projection only.

The keys carrying viewer data without a viewer id:

| key | viewer-specific payload | source |
|---|---|---|
| `["mediaDetail", mediaId]` | `mediaListEntry { id status progress score repeat notes }` via `MEDIA_FIELDS` (`queries.ts:44`) plus `isFavourite` | `AnimeDetail.tsx:110` |
| `["seasonal", season, year, level]` | `mediaListEntry` via `MEDIA_FIELDS` | `Seasonal.tsx:59` |
| `["search", type, term, …, level]` | `mediaListEntry` via `MEDIA_FIELDS` | `Search.tsx:209-231` |
| `["franchise", rootId, level]` | `mediaListEntry { status progress }` | `Franchise.tsx:74` |
| `["recommendations", type, seedIds]` | `mediaListEntry` and `userRating` — this viewer's own vote | `RecommendedSection.tsx:79` |
| `["social","forum","subscribed", …]` | the viewer's subscribed threads | `Forum.tsx:161` |

`["mediaList", type, userId]`, `["userStats", userId, scoreFormat]`,
`["wrapped", viewer?.id]` and the bell's two `viewerId` keys *are* correctly
viewer-keyed, which is what makes the list above an inconsistency rather than a
design.

The same mechanism is filed as **A3-01 in `ACCOUNT_ISOLATION.md`**, which owns it
as an account-isolation defect and carries the release severity for it. The entry
here covers only the UI-facing half: what is drawn, and what the editor is seeded
from.

Expected Behavior:
Signing out — and signing in as somebody else — starts from an empty server cache,
so no screen can render or seed an editor from the previous account's data.

Actual Behavior:
The cache survives the whole switch. The global `staleTime: 5 * 60 * 1000`
(`main.tsx:22`) means there is no refetch at all for five minutes, and
`gcTime: 30 * 60 * 1000` keeps entries alive after unmount, so B sees A's status
ring, progress, score and free-text notes. `MediaCard.tsx:72` computes
`media.mediaListEntry ?? cached ?? null` and hands it to `EntryEditModal`
(`MediaCard.tsx:163-170`), whose Save calls `saveListEntry`
(`src/api/anilist.ts:154-161`) → `save_list_entry` under B's token.
`EntrySaveInput` carries `mediaId` only (`types.ts:219-240`), so the write is not
addressed to A's entry id — it lands on B's entry for that media.

Reproduction:
Sign in as A, open a detail page for a title on A's list, note the progress →
Settings → Account → Log out (`AccountPane.tsx:107`) → sign in as B in the same
window → navigate back to that `/media/:id` within five minutes. A's progress,
score, notes and favourite heart are shown for B. Open the editor from a seasonal
or search card and press Save to write them onto B's list.

Impact:
Cross-account display of private list fields, and a silent transplant of A's
numbers onto B's AniList list if the user saves from a stale card. The quick-add
"+" path is safe — it sends only `{ mediaId, status }` (`MediaCard.tsx:126-131`) —
so the destructive half additionally requires opening the editor.

Root Cause:
Account identity is encoded per-key rather than enforced once at the cache
boundary. The maintainer has already fixed this class key-by-key
(`useNotifBadge.ts:29`, "viewer id included — the cross-account lesson") and once
in Rust (schema v16's `user_id` on `offline_queue`); the frontend cache never got
the equivalent systemic guard.

Recommended Fix:
Clear the server cache on any identity change. The store cannot import the query
client without a cycle, so register a callback the way
`api.setTokenRejectedHandler` already is (`auth.ts:125`), or mount a small
component in `App` that calls `qc.clear()` whenever `viewer?.id` changes; call it
from `logout()`, `connect()`, `enableLocal()` and the `anilist-auth` listener.
Belt-and-braces: add the viewer id (or `mode`) to the six keys above so a missed
clear degrades to a cache miss rather than to somebody else's data.

Regression Tests Required:
- A dom test that seeds `["mediaDetail", 1]` with `mediaListEntry.progress = 7`,
  calls `logout()` then signs in as a different viewer, mounts `AnimeDetail`, and
  asserts the progress badge is not `7`.
- A pure test over the key catalogue asserting every key whose payload includes
  `mediaListEntry`, `isFavourite` or `userRating` contains a viewer id.
- A test that `logout()` empties the query cache.

Confidence: HIGH. Verification: downgraded from P1 — the whole finding is gated on
an in-session account switch, which is not a path an ordinary single-account
desktop install takes, and the destructive half additionally needs the user to open
the editor on a stale card and press Save.

---

ID: B4-03
Severity: P3
Category: BUG

File: /home/user/Karasu/src/api/social.ts
Line: 1458-1492 (`SITE_NOTIFICATIONS_QUERY`), rendered at /home/user/Karasu/src/components/shell/Bell.tsx:125-162 and :350-353
Function: `siteNotifications` / `Bell.siteText`

Problem:
Every AniList notification row that names a media title is rendered by the bell
with no content-filter check, and *cannot* be checked, because the query does not
select the two fields `isBlocked` needs.

All five media-bearing inline fragments select only
`media { id title { romaji english native } }`:
`AiringNotification`, `RelatedMediaAdditionNotification`,
`MediaDataChangeNotification`, `MediaMergeNotification` and
`MediaSubmissionUpdateNotification`. No `isAdult`, no `genres`.
`grep -n "contentFilter\|isBlocked" src/components/shell/Bell.tsx` returns
nothing, and the `siteRows` memo (`Bell.tsx:350-353`) flattens the pages with no
filter before `unify(...)` hands them to the renderer.

Expected Behavior:
A title the content filter blocks does not appear in the bell, matching every
other surface and matching the Rust alert passes, which filter before they speak.

Actual Behavior:
With the filter at `strict` or `moderate`, an AniList airing notification for an
adult title the user follows renders in the bell as "Episode 5 aired" beside the
full title.

Reproduction:
Sign in with an account that follows an `isAdult` title with airing episodes, set
the content filter to `strict`, open the bell. The AniList half of the stream
shows the title.

Impact:
Explicit titles appear in a panel reachable from every screen, in the one app area
that promises they will not. The asymmetry is what makes it a defect rather than a
policy: `alerts/airing.rs:197` and `:218-223`, `alerts/sequel.rs:208-213` and
`alerts/stale.rs:91-95` all filter, and `stale.rs:189-193` carries a test named
for the identical concern. The AniList half has no equivalent. Severity stays at
P3 because it needs an adult title with airing episodes on the account and only a
title string is shown.

Root Cause:
`SITE_NOTIFICATIONS_QUERY` was written to the minimum a row needs to draw, and the
filter's two input fields were not counted as part of that minimum.

Recommended Fix:
Add `isAdult genres` to the five `media { … }` selections, widen
`RawSiteNotification.media` (`siteNotifications.ts:77-80`) and `SiteNotifRow` to
carry them, and filter in `Bell`'s `siteRows` memo with `isBlocked(row.media, level)`
the way `ActivityFeed.tsx:81` does. Validate the widened query live per the
Conventions note before wiring it.

Regression Tests Required:
- A pure test over `normalizeSiteNotification` asserting the adult flags survive
  into the row.
- A dom test: a bell with one adult airing row at `level: "strict"` renders no
  title.

Confidence: HIGH

---

ID: B4-06
Severity: P3
Category: BUG

File: /home/user/Karasu/src/pages/Calendar.tsx
Line: 56 (the `Slot.media` type) and 348-352 (the cover `<img>`); also /home/user/Karasu/src/components/shell/CommandPalette.tsx:285-293, /home/user/Karasu/src/pages/LocalLibrary.tsx:978-987, /home/user/Karasu/src/components/social/ActivityCard.tsx:266-280, /home/user/Karasu/src/components/overlays/MatchPicker.tsx:325-334
Function: several cover render sites

Problem:
`blur_adult` ("blur explicit artwork until it is clicked") is honoured on eight
cover surfaces and silently skipped on five, each of which draws a bare `<img>`
rather than going through `CoverCell`'s `blurred` prop.

Applies `shouldBlur`: `MediaCard.tsx:92`, `MediaList.tsx:908` and `:938`,
`Dashboard.tsx:255`, `SeasonHero.tsx:113`, `MediaStrip.tsx:51`,
`UserLists.tsx:162`, `AnimeDetail.tsx:207` (plus the lightbox guard at `:283-291`).

Does not: `Calendar.tsx:348-352`, `CommandPalette.tsx:285-293`,
`LocalLibrary.tsx:978-987`, `ActivityCard.tsx:266-280` and `MatchPicker.tsx:325-334`
(`ResultRow`). All five re-read and confirmed as bare `<img>` elements.

Calendar additionally *cannot* apply it as written: `Slot.media` is
`Pick<Media, "id" | "title" | "coverImage">` (`Calendar.tsx:56`), so `isAdult` is
typed away between the filter check (`:141`) and the render even though the runtime
object from `x.entry.media` still carries it.

Expected Behavior:
With `blurAdult` on, every surface that draws an `isAdult` cover veils it.

Actual Behavior:
With the filter Off and blur On, the same title's cover is veiled on the list,
dashboard, search, seasonal and detail pages, and shown bare in the calendar, the
command palette, the local library, activity cards and the match picker.

Reproduction:
Settings → Content: filter Off, "blur explicit artwork" on. Put an `isAdult` anime
with an airing schedule on the list. `/list` blurs the cover; `/calendar` (lens
"My shows") does not; Ctrl+K and typing the title does not.

Impact:
The setting does not mean what it says on five surfaces, one of which (the command
palette) is two keystrokes from every screen. `shouldBlur`
(`contentFilter.ts:110-118`) answers *veil* at every level once `blurAdult` is on,
and `contentFilter.ts:100-107` names the filter-Off configuration as the one the
setting exists for — where the blur is the only protection, because a blocked title
is never rendered at all. `blur_adult` is seeded **on** for new installs (schema
v17), so the default configuration for anybody who turns the filter off is exactly
the inconsistent one.

Root Cause:
`shouldBlur` was added per render site rather than folded into the shared cover
primitive. `CoverCell` already takes a `blurred` prop; the five sites draw their
own `<img>`.

Recommended Fix:
Route the five sites through `CoverCell`'s `blurred` prop, or call
`shouldBlur(media, level, blurAdult)` locally. For Calendar, widen `Slot.media` to
include `isAdult` — it is already present on `AiringSlot` (`queries.ts:340-345`)
and the "mine" branch takes it from `x.entry.media`, which is a full `Media`.

Regression Tests Required:
- A dom test per surface: `level: "off"`, `blurAdult: true`, one `isAdult` item,
  assert the cover element carries the blur class.

Confidence: HIGH

---

ID: B4-07
Severity: P3
Category: BUG

File: /home/user/Karasu/src/hooks/useGridRoving.ts
Line: 112 (the return), consumed at /home/user/Karasu/src/pages/Search.tsx:737 and :777, /home/user/Karasu/src/pages/Seasonal.tsx:83 and :157
Function: `useGridRoving` consumers

Problem:
`useGridRoving` moves a *virtual* cursor — it sets a `focus` index that a card
renders as a drawn ring — and on Search and Seasonal nothing scrolls that card
into view. The hook returns `{ focus, setFocus }` and does nothing else with the
index. On `MediaList` the cursor is fed to `VirtualGrid`, which scrolls
(`VirtualGrid.tsx:68-74`, `virtualizer.scrollToIndex(...)`); that is the only
`scrollToIndex` in the app, and only `MediaList` uses it. `Search.tsx:737/777` and
`Seasonal.tsx:83/157` use `focus` purely as a `focused` prop. The only
`scrollIntoView` calls in `src/` are `CommandPalette.tsx:195` and
`CommentTree.tsx:61`, neither of which is a grid.

Expected Behavior:
Arrow-keying past the fold brings the focused card into view, as it does on the
list page.

Actual Behavior:
The ring moves onto an off-screen card and the viewport stays put; from the user's
side nothing happens, and further presses move an invisible cursor. Enter then
opens a title they cannot see.

Reproduction:
`/search`, search anything with more than two rows of results, click nothing, press
ArrowDown four or five times. The page does not scroll.

Impact:
Keyboard navigation of the two "wall of cards" screens is unusable past the first
visible rows — and those are the two screens the hook's own docstring
(`useGridRoving.ts:15-20`) says it exists for, which is what makes the missing half
a defect rather than a scope decision.

Root Cause:
The scroll half of the behaviour lives in `VirtualGrid`, which only `MediaList`
uses.

Recommended Fix:
Give `useGridRoving` an optional `onFocusChange(index)`, or have the two pages run
an effect on `focus` that calls
`document.querySelector('[data-media-id="…"]')?.scrollIntoView({ block: "nearest" })`,
reading `prefersReducedMotion()` from `lib/motion.ts` for the `behavior` — a scroll
handler is exactly the motion CSS cannot see. `MediaCard` already emits
`data-media-id` (`MediaCard.tsx:91`), so the lookup needs no new plumbing.

Regression Tests Required:
- A dom test asserting `scrollIntoView` is called on the newly focused card after
  an ArrowDown, and is not called when `focus` is null.

Confidence: HIGH

---

ID: B4-09
Severity: P3
Category: BUG

File: /home/user/Karasu/src/pages/Dashboard.tsx
Line: 319-329
Function: `WeeklyDigest`

Problem:
`dashboard.thisWeekSummary` is a single non-plural string interpolated with two
counts that can both be 1, and the only guard is `length === 0`.

```ts
// src/pages/Dashboard.tsx:320
if (thisWeek.length === 0) return null;
const shows = new Set(thisWeek.map((x) => x.mediaId)).size;
…
meta={t("dashboard.thisWeekSummary", { count: thisWeek.length, shows })}
```

```ts
// src/i18n/en.ts:320
thisWeekSummary: "{{count}} episodes across {{shows}} shows air this week.",
```

Neither `en.ts` nor `de.ts` defines any `_one`/`_other` variant, so i18next falls
back to the base string.

Expected Behavior:
"1 episode across 1 show airs this week.", and the equivalent singular of
`de.ts:318-319` in German.

Actual Behavior:
"1 episodes across 1 shows air this week."

Reproduction:
Have exactly one show on the list with exactly one episode airing in the next seven
days, open `/`.

Impact:
Broken grammar on the app's landing screen, reachable by anyone watching a single
weekly show.

Root Cause:
The string was written as prose with two interpolations and the singular case was
not enumerated. Every other count string in the app avoids this with an explicit
ternary — `Sidebar.tsx:212` and `BulkBar.tsx:138` — which is the shape
`i18nKeys.test.ts`'s `TERNARY` regex exists to see. This call site is the outlier.

Recommended Fix:
Follow the house pattern: add `thisWeekSummaryOne` (and, since the two counts can
diverge, a variant for one show with several episodes) and select with a literal
ternary so `i18nKeys.test.ts` still sees every key. i18next's plural suffixes would
work too but would be the only place in the codebase using them, and would be
invisible to that test.

Regression Tests Required:
- A dom test rendering `WeeklyDigest` with one entry and asserting the text is not
  "1 episodes".

Confidence: HIGH

---

ID: B4-16
Severity: P3
Category: BUG

File: /home/user/Karasu/src/components/media/MediaCard.tsx
Line: 42-59 (the mutation), 50-57 (the assignment)
Function: `MediaCard.saveEntry.onSuccess`

Problem:
The save handler writes into TanStack-owned query data by mutating the `media`
prop in place rather than going through `setQueryData`.

```ts
// src/components/media/MediaCard.tsx:50
// Patch the discovery cache locally instead of refetching (rate limit)
media.mediaListEntry = {
  id: result.entry?.id ?? media.mediaListEntry?.id ?? 0,
  status: input.status ?? media.mediaListEntry?.status ?? "PLANNING",
  …
};
```

`media` is an element of the array held under `["search", …]` or `["seasonal", …]`
(and, on the detail page's strips, other keys). Assigning to it changes the cached
object without notifying the cache.

Expected Behavior:
A local patch of cached data goes through `qc.setQueryData(key, updater)`, which
notifies every observer of that key and produces a new object for structural
sharing to compare.

Actual Behavior:
No observer is notified. The card that performed the save re-renders only because
its own mutation state changed; a second card, a strip or a page showing the same
media object under the same key keeps its old paint until something else triggers
a render. The mutated object also survives structural sharing in ways nothing in
the suite pins, and it is the mechanism that makes B4-01's stale entry stickier
than a plain read: after an account switch the object carries A's numbers and
nothing re-derives it.

Reproduction:
Open `/search` with a term whose results include the same title twice (e.g. a
result also shown by a mounted `MediaStrip`), quick-edit one of them and save. Only
the card that was edited updates.

Impact:
Stale status rings and progress numbers on any co-mounted view of the same cached
media, with no error and nothing to indicate the save landed elsewhere. The
avoid-a-refetch intent (rate limit) is right and documented; only the mechanism is
wrong.

Root Cause:
The cheapest way to write the value back was to write it where it was read from.
The invalidation immediately above it (`qc.invalidateQueries({ queryKey: ["mediaList", media.type] })`)
covers the list keys, so the discovery keys were patched by hand and the notify
half was lost.

Recommended Fix:
Replace the assignment with a `setQueryData` over the keys this card can belong
to, or lift the patch into the shared mutation layer (`useListMutations`) so one
place owns it. Keep the intent — no refetch — and keep the comment explaining why.

Regression Tests Required:
- A dom test mounting two cards for the same media from one seeded query key,
  saving on one, and asserting the other's status ring updates.
- A test asserting the object identity under the query key changes after a save
  (i.e. the cache was written, not mutated).

Confidence: MEDIUM. Source: found during adversarial verification.

---

ID: B4-04
Severity: P4
Category: BUG

File: /home/user/Karasu/src/components/shell/Bell.tsx
Line: 430-466
Function: `Bell.renderLocal`

Problem:
Karasu's own notification rows are filtered at write time in Rust and never
re-checked at render, so a row written while the filter was permissive keeps naming
its title after the filter is tightened.

`alerts/airing.rs:197` reads the level once and skips blocked media at `:218-223`;
the surviving row is persisted with the title baked into `title`/`body`
(`alerts/notify.rs:44-48`). Rows are retained at `NOTIF_KEEP = 500` and read back
100 at a time. `renderLocal` prints `n.title` and `n.body` with no filter.

Expected Behavior:
Tightening the content filter hides already-stored rows for blocked titles, the way
it hides already-fetched list entries (`MediaList.tsx:321` re-runs `blockReason`
on every render against the current level).

Actual Behavior:
Rows written under `off` survive a switch to `strict` and keep naming the title.

Reproduction:
Set the content filter to Off. Let a sequel or stale pass fire for an `isAdult`
title on the list. Switch the filter to `strict`. Open the bell — the row is still
there with the title in its body.

Impact:
Narrow. It requires the user to have had the filter Off at write time, is bounded
by the 500-row retention, and asks the app to retroactively re-censor already
delivered notifications. The airing case is narrower still:
`alerts/airing.rs:227-236` writes **no bell row at all** when the account has
AniList's own notification (`anilist_has_it` → `notify_toast`), so airing only
stores rows for local or signed-out profiles. The write-time guard — the thing the
Rust test pins — is present everywhere it should be.

Root Cause:
The filter is applied at the write boundary only. The stored row is a rendered
sentence, not a media object, so the render side has nothing structured left to
test; `media_id` (schema v15) exists but is used for navigation.

Recommended Fix:
If it is worth doing at all: have the bell resolve `n.mediaId` against the cached
list (`["mediaList", type, userId]`, which `CommandPalette.tsx:117` already reads
directly) and suppress a row whose media `isBlocked` at the current level. Rows
with a null `mediaId` name no title and are unaffected. Equally defensible to
document the current behaviour as intended and close it.

Regression Tests Required:
- If fixed: a dom test that a stored `airing` row whose `mediaId` resolves to an
  adult entry in the seeded list cache is not rendered at `level: "strict"`.

Confidence: MEDIUM. Verification: downgraded from P3 — the airing path stores no
row when AniList already notified, so what remains is a stale history artifact
behind a filter the user had switched off, and re-censoring delivered
notifications is a defensible product position rather than a clear defect.

---

ID: B4-05
Severity: P4
Category: BUG

File: /home/user/Karasu/src/components/overlays/MatchPicker.tsx
Line: 112-121; and /home/user/Karasu/src/components/overlays/SeasonSplitModal.tsx:92-98
Function: `MatchPicker` search query / `SeasonSplitModal` search query

Problem:
Both overlays call `searchMedia` without the `isAdult` argument, so the server-side
filter is not applied and the page is trimmed only on arrival — the failure mode
the query's own comment warns against.

```ts
// MatchPicker.tsx:113
queryFn: () => searchMedia(debounced, mediaType),   // 4th arg `isAdult` omitted
…
const results = useMemo(
  () => (data?.media ?? []).filter((m) => !isBlocked(m, level)),   // :119-122
  [data, level],
);
```

`SeasonSplitModal.tsx:93` does the same with `"ANIME"`.
`searchMedia(search, type, page = 1, isAdult?)` (`queries.ts:74-83`) spreads
`...adultVars(isAdult)`, and `adultVars(undefined)` returns `{}`
(`contentFilter.ts:86-88`) — the argument is genuinely absent. `queries.ts:60-63`
states why that is wrong here ("a page filtered only on arrival can come back
almost empty and read as 'no results'"), and `queries.ts:91` already records that
these two call sites use `SEARCH_QUERY` bare. Neither overlay renders a
`FilteredNotice`; `grep -rn "FilteredNotice" src/components/overlays/` returns
nothing.

Expected Behavior:
Both overlays pass `adultQueryArg(level)` so the 30-result page is 30 usable
results, matching Search and Seasonal.

Actual Behavior:
At `moderate`/`strict`, a term whose AniList matches are largely adult returns a
page locally trimmed to a fraction of its size, with no disclosure line. At `off`
there is no difference.

Reproduction:
Set the filter to `strict`, open the now-playing card's match picker (or the
library's "correct this match"), and search a term whose AniList results are
largely `isAdult`.

Impact:
Limited. Both boxes are searched with a specific parsed release title rather than a
broad browse term, so the near-empty page needs a title whose matches are mostly
adult — a narrow case. Nothing is rendered that should not be; the cost is a partly
discarded page and, in that narrow case, a dead end on the screen that exists to
unstick a mismatched detection.

Root Cause:
`searchMedia` made `isAdult` optional and the two overlay call sites predate the
server-side filtering decision.

Recommended Fix:
Pass `adultQueryArg(level)` as the fourth argument at both call sites, and add
`level` to both query keys (see B4-19). The existing client-side `isBlocked` pass
stays as the belt-and-braces layer.

Regression Tests Required:
- A pure test asserting `searchMedia`'s variables contain `isAdult: false` when
  called with `adultQueryArg("strict")` and omit the key entirely for `"off"` —
  `src/lib/adultVars.test.ts` pins `adultVars` but nothing pins that the call sites
  use it.

Confidence: HIGH. Verification: downgraded from P3 — both boxes are searched with a
specific parsed title, not a browse term, so the near-empty page is a narrow case
and the divergence is already recorded at `queries.ts:91`.

---

ID: B4-08
Severity: P4
Category: BUG

File: /home/user/Karasu/src/pages/settings/AdvancedPane.tsx
Line: 838-841, 855-861; /home/user/Karasu/src/pages/settings/AniListPane.tsx:647-650; /home/user/Karasu/src/pages/settings/IntegrationsPane.tsx:30-37
Function: `UpdatesSection`, `NotificationScheduleSection`, `DiscordSection.save`

Problem:
Four settings controls paint optimistically and then fire a fallible backend write
with no rollback and no error surface — the exact pattern the same pane elsewhere
calls out and fixes.

```ts
// AdvancedPane.tsx:838 — update-check toggle
onChange={(enabled) => { setAuto(enabled); api.setUpdateCheckAuto(enabled); }}
// AdvancedPane.tsx:855 — update channel
onChange={(e) => { const next = …; setChannel(next); api.setUpdateChannel(next); }}
// AniListPane.tsx:647 — background notification interval
const commit = (m: number) => { setMinutes(m); setNotifSchedule(m).catch(() => {}); };
// IntegrationsPane.tsx:30 — Discord enable + app id
const save = async (next: DiscordSettings) => {
  setSettings(next);
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_discord_settings", { enabled: next.enabled, appId: next.appId });
};
```

`AdvancedPane.SystemSection` documents the house rule at `:711-717` ("Without the
rollback the switch kept reading 'on' for the rest of the session while nothing had
been configured, and the rejection went nowhere"), with the working pattern at
`:718-745`; `DetectionPane.persist` and `stores/contentFilter.setLevel` implement
the same rule. All four commands are `Result`-returning
(`update.rs:60-76`, `:85-88`; `prefs.rs:29-45`, `:125-139`).

Expected Behavior:
A rejected write puts the control back and says so, as `toggleAutostart`,
`toggleCloseTray`, `applyHotkey`, `DetectionPane.persist` and `setLevel` all do.

Actual Behavior:
`AniListPane.commit` swallows the rejection outright; the two `UpdatesSection`
handlers and `DiscordSection.save` leave the promise unhandled, so it reaches the
`unhandledrejection` reporter in `main.tsx:44` and is logged, but nothing on screen
changes.

Reproduction:
Not reachable without inducing a SQLite write failure (a read-only or full
database). The defect is the missing branch.

Impact:
Consistency gap in error handling rather than a behaviour a shipped install
exhibits: each failure path is a `db.kv_set` on the app's own SQLite file, and
`set_update_channel`'s only other error is an invalid channel string the `<select>`
cannot produce. The sibling the pane's rollback comment names, `set_autostart`, has
a real Linux failure mode; these four do not. Worth noting that the notification
interval is shared with Android's `NotifScheduler` (`prefs.rs:113-118`), so a
failure there would let the phone and the UI disagree about what is configured.

Root Cause:
The rollback idiom was introduced pane-by-pane and these four sections were not
converted.

Recommended Fix:
Hoist `DetectionPane`'s `persist(save, revert)` helper into
`pages/settings/shared.tsx` and apply it at all four sites, with the section's
existing error line rendering the message. `IntegrationsPane` has no error line and
would need one.

Regression Tests Required:
- A dom test per control: stub the invoke to reject, assert the control reverts and
  an error is rendered. `pages/settings/shared.dom.test.tsx` is the natural home.

Confidence: HIGH. Verification: downgraded from P3 — none of the four commands can
fail for a reason a user will meet, so this is a consistency gap in error handling
rather than a shipped behaviour.

---

ID: B4-11
Severity: P4
Category: IMPROVEMENT

File: /home/user/Karasu/src/app/App.tsx
Line: 192-200
Function: `App` — the routed `<main>`

Problem:
There is no scroll restoration anywhere in the app, and the routed pane is keyed on
the pathname, which guarantees a fresh scroll container on every navigation.

```tsx
// src/app/App.tsx:192
<main
  key={pathname}
  id="main"
  tabIndex={-1}
  className="min-w-0 flex-1 animate-settle overflow-y-auto outline-none"
>
```

`<main>` is the scroll container and it is keyed on `pathname`, so React unmounts
and remounts it on every route change — a brand-new element at `scrollTop: 0`.
There is no `scrollTop`, `scrollTo`, `ScrollRestoration` or stored offset anywhere
in `src/`; the one `scrollTo`-family hit is `VirtualGrid.tsx:71`, which is the
roving-cursor scroll. `HashRouter` is declarative, so react-router's
`<ScrollRestoration>` is not available — the same constraint
`useViewTransitions.ts:14-19` documents.

Expected Behavior:
Going back from a detail page to a list returns the user to the row they came from.

Actual Behavior:
Every navigation, including Back, lands at the top of the page.

Reproduction:
`/list`, scroll to the 200th title, open it, press Back. The list is at the top.

Impact:
Losing place is the dominant interaction on a list-first app: browsing a long list
means open → back → open → back, and every Back costs a re-scroll. The virtualized
grid makes it worse, because the rows the user was reading are not in the DOM to
hunt for.

Root Cause:
The key on `<main>` exists to replay the arrival animation (the comment at
`:188-191` says so). Restoration was never added alongside it.

Recommended Fix:
Keep a `Map<pathname, scrollTop>` (module-level or `sessionStorage`), write it on
navigation away, and restore it in a layout effect on mount — for the virtualized
pages restore through `virtualizer.scrollToOffset`, since the rows are not measured
on the first frame. Alternatively move the animation key onto an inner wrapper so
`<main>` itself survives navigation.

Regression Tests Required:
- A dom test navigating away from and back to a scrolled route and asserting the
  offset is restored.

Confidence: HIGH. Verification: downgraded from P3 — nothing in the codebase ever
claimed restoration and no invariant is violated; this is a feature request against
an app that has always behaved this way, and whether "always top" is acceptable is
a product call.

---

ID: B4-12
Severity: P4
Category: CODE SMELL

File: /home/user/Karasu/src/stores/auth.ts
Line: 128-134
Function: `useAuth.init`

Problem:
`init()` registers a Tauri event listener with no unsubscribe and no idempotency
guard, unlike its sibling `useNowPlaying.init`.

```ts
// src/stores/auth.ts:128
listen<Viewer>("anilist-auth", (e) =>
  set({ viewer: applyViewer(e.payload), mode: applyMode("anilist"), sessionExpired: false }),
);
```

The registration promise is neither awaited nor stored, so no `unlisten` handle
exists. `useNowPlaying.init` (`nowPlaying.ts:70-88`) guards with a module-level
`initialized` flag (`:66`, `:74-75`); `auth.init` has no such guard.

Expected Behavior:
One listener, matching `useNowPlaying`.

Actual Behavior:
One listener in a shipped build; N in a dev session. `App.tsx:84-89` calls it from
an effect under `<React.StrictMode>` (`main.tsx:53`), so a development build
registers twice, and Vite HMR adds one per edit of `App.tsx`. In production `App`
is the root and never unmounts, so the missing cleanup costs nothing. The suite is
unaffected: `src/test/render.tsx` drives `useAuth.setState` directly and never
calls `init()`.

Reproduction:
`npm run dev`, edit `App.tsx` a few times, complete a one-click AniList login and
observe the store setter running once per registration.

Impact:
Dev-only today, and every handler runs the same idempotent `set(...)` with the same
payload. It becomes a real leak the moment the handler stops being idempotent, or
the moment `init()` is called from a component that unmounts.

Root Cause:
The two stores were written at different times; only one grew the guard.

Recommended Fix:
Add the same `let initialized = false` guard `useNowPlaying` uses, or store and
expose the `unlisten` handle.

Regression Tests Required:
- A test calling `init()` twice and asserting `listen` was invoked once.

Confidence: HIGH

---

ID: B4-13
Severity: P4
Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/src/lib/i18nKeys.test.ts
Line: 52
Function: the `DYNAMIC_PREFIXES` docstring

Problem:
The comment claims a companion test file that does not exist:

```
 * and worth naming: a member missing from one of these families is invisible to
 * *both* directions and ships as a raw key. `i18nFamilies.test.ts` covers the
 * ones with a fixed membership.
```

`grep -rn "i18nFamilies" src/` returns exactly one hit — this comment — and
`ls src/lib | grep -i i18n` returns only `i18nKeys.test.ts`.

Expected Behavior:
A comment naming a file that exists, or naming the mechanism that actually does the
job.

Actual Behavior:
A reader looking for `i18nFamilies.test.ts` finds nothing and may conclude the
exemptions at `:56-68` are unguarded.

Reproduction:
`ls src/lib/i18nFamilies.test.ts` → no such file.

Impact:
Documentation only. Worth fixing because the surrounding paragraph is warning about
a real gap and the misdirection makes that gap harder to size. The work the
sentence describes *is* done — by `DYNAMIC_KEYS` (`:73-99`) in the same file,
asserted by "keeps every closed dynamic union complete". The twelve
`DYNAMIC_PREFIXES` are exempted but their membership is not asserted; the two
largest were checked by hand and are complete, and `lib/format.ts` guards
`format.`, `mediaStatus.` and `source.` with a `KNOWN` set plus a `titleCase`
fallback, so an unlisted enum value degrades to a title-cased word rather than a
raw key.

Root Cause:
A planned second test file was folded into the first and the comment was not
updated.

Recommended Fix:
Reword to point at `DYNAMIC_KEYS` in the same file.

Regression Tests Required:
None (documentation).

Confidence: HIGH

---

ID: B4-15
Severity: P4
Category: IMPROVEMENT

File: /home/user/Karasu/src/hooks/useGridRoving.ts
Line: 25-112, with the precondition at :69
Function: `useGridRoving`

Problem:
The roving cursor is painted, not focused. `focus` is an index that becomes a
`ring-2 ring-accent-500` class (`MediaCard.tsx:77-82`, `GridCard.tsx:74`); DOM
focus never moves, and there is no `aria-activedescendant`, no
`role="grid"`/`role="gridcell"` and no roving `tabIndex` anywhere in `src/`.

Expected Behavior:
A screen reader announces the card the arrow keys landed on.

Actual Behavior:
The active element stays on `<body>` throughout — `ownsKeyboard(document.activeElement,
document.body, null)` at `:69` is in fact the *precondition* for the handler to run
at all — so assistive technology is told nothing when the cursor moves.

Reproduction:
Turn on a screen reader, open `/list`, press ArrowDown. Nothing is announced.

Impact:
Arrow-key browsing of the grids is sighted-only. Keyboard *reachability* is
unaffected: Tab still walks the cards' links and buttons, so this is a quality gap
rather than a lockout.

Root Cause:
Real DOM focus over a virtualized list is genuinely hard — the focused node may not
be mounted — which is exactly why the drawn ring was chosen, and `MediaCard.tsx:77-79`
records that reasoning. `aria-activedescendant` is the pattern designed for that
case and needs the id, not the node.

Recommended Fix:
Give each card a stable `id`, put `role="grid"` + `aria-activedescendant={focusedId}`
+ `tabIndex={0}` on the grid container, and `role="gridcell"` on the cards. This
works over the virtualized list precisely because `aria-activedescendant`
references an id rather than requiring focus to move. Pairs naturally with B4-07,
which supplies the scroll the announcement implies.

Regression Tests Required:
- A dom test asserting `aria-activedescendant` on the container tracks the focused
  index.

Confidence: HIGH

---

ID: B4-17
Severity: P4
Category: CODE SMELL

File: /home/user/Karasu/src/pages/AnimeDetail.tsx
Line: 1447; also /home/user/Karasu/src/pages/About.tsx:164 and /home/user/Karasu/src/pages/Wrapped.tsx:864
Function: the three "Saved ✓" confirmations

Problem:
Three handlers arm a bare 2 s `setTimeout` that writes component state, with no
cleanup and no ref to cancel it:

```ts
// AnimeDetail.tsx:1446 (mutation onSuccess)
setSaved(true);
setTimeout(() => setSaved(false), 2000);
// About.tsx:164 (copy diagnostics)
if (ok) setTimeout(() => setCopied(false), 2000);
// Wrapped.tsx:863 (save image)
if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
```

If the user navigates away inside the two seconds — trivial on all three screens —
the callback fires against an unmounted component.

Expected Behavior:
A timer that writes state is stored and cleared on unmount, as every other timer in
the app is: `useCountdown` (`NowPlayingCard.tsx:38-44`), `PlaybackError`
(`App.tsx:290-294`), `useListSummary`'s 60 s tick (`:59-63`), `usePresence`'s exit
timer (`:41-72`) and `stores/toast.ts` (`:46`, `:52`).

Actual Behavior:
Three timers outlive their component. React 19 no longer warns about a state
update on an unmounted component and the setter is a no-op, so nothing is visible.

Reproduction:
Open a title, save an edit, navigate away within two seconds.

Impact:
None observable today. It is filed because it is the same class as B4-12 — a
lifecycle the codebase otherwise handles carefully — and because the frontend
pass's own "Verified sound" paragraph claimed every timer clears on cleanup, which
these three contradict. That claim has been corrected in this report.

Root Cause:
Three one-off confirmation flashes written inline in handlers rather than through a
shared "flash a confirmation" hook.

Recommended Fix:
Store the id in a ref and clear it in a cleanup effect, or extract the pattern —
all three are the identical `setX(true)` / 2 s / `setX(false)` — into one small
hook next to `usePresence`.

Regression Tests Required:
- A dom test unmounting the component inside the window with fake timers and
  asserting no state update is attempted.

Confidence: HIGH. Source: found during adversarial verification.

---

ID: B4-18
Severity: P4
Category: CODE SMELL

File: /home/user/Karasu/src/hooks/useGridRoving.ts
Line: 48-52
Function: `useGridRoving`

Problem:
The hook writes a ref during render, outside any effect:

```ts
// src/hooks/useGridRoving.ts:48
const [focus, setFocus] = useState<number | null>(null);
// Read through a ref so the listener can stay mounted for the life of the
// screen: re-registering it on every focus change would be a subscription
// churning once per keypress.
const state = useRef({ focus, count, columns, onOpen, sections });
state.current = { focus, count, columns, onOpen, sections };
```

The intent — a stable listener reading current values through a ref — is right and
documented. The mechanism is a render-phase side effect.

Expected Behavior:
The ref is synchronised in an effect (or the object is built inside the listener
from state read through a single `useRef` updated in `useEffect`), so a discarded
render cannot leave the ref describing a state that was never committed.

Actual Behavior:
Every render, committed or not, overwrites `state.current`. It works today because
the component is not suspended and the values are recomputed on the next render
anyway.

Reproduction:
None that misbehaves today; this is a latent hazard, not a reproducible defect.

Impact:
Latent. It is the one hook StrictMode double-renders on every keypress, and it is
the exact class of hazard B4-12 is filed for — a pattern that is harmless until the
surrounding conditions change (a Suspense boundary above either grid, or
concurrent rendering discarding a render).

Root Cause:
The ref-as-mailbox idiom was written for the cheapest possible update path.

Recommended Fix:
Move the assignment into a `useEffect` with the five values as deps, or accept it
and add a comment saying the render-phase write is deliberate and why it is safe
here — the current comment explains the ref, not the timing.

Regression Tests Required:
- None specific; the existing roving-cursor dom tests cover the behaviour. If the
  assignment moves into an effect, keep a test that a keypress immediately after a
  count change acts on the new count.

Confidence: MEDIUM. Source: found during adversarial verification.

---

ID: B4-19
Severity: P4
Category: CODE SMELL

File: /home/user/Karasu/src/components/overlays/MatchPicker.tsx
Line: 113; and /home/user/Karasu/src/components/overlays/SeasonSplitModal.tsx:93
Function: the two overlay search queries

Problem:
Both query keys omit the content-filter level:

```ts
queryKey: ["matchSearch", mediaType, debounced],   // MatchPicker.tsx:113
queryKey: ["splitSearch", debounced],              // SeasonSplitModal.tsx:93
```

Every other filtered surface carries `level` in its key — `["search", …, level]`
(`Search.tsx:209-231`), `["seasonal", season, year, level]` (`Seasonal.tsx:59`),
`["franchise", rootId, level]` (`Franchise.tsx:74`) — because the payload depends
on it.

Expected Behavior:
A key names every input the cached value depends on.

Actual Behavior:
One key holds a page that may have been fetched under a different level. It is
harmless *today* only because these two call sites fetch unfiltered (B4-05) and
redo the trimming in a memo keyed on `level` (`MatchPicker.tsx:119-122`,
`SeasonSplitModal.tsx:112-115`).

Reproduction:
Search in the match picker, close it, change the content filter, reopen and search
the same term: the same cache entry is served. Today the memo re-trims it, so
nothing wrong is shown.

Impact:
None observable today; it becomes a live correctness bug the moment B4-05 is fixed
and the server does the filtering, at which point the cached page would be the one
fetched under the previous level.

Root Cause:
The two overlays predate the server-side filtering decision and were keyed for
their own inputs only.

Recommended Fix:
Add `level` to both keys — `["matchSearch", mediaType, debounced, level]` and
`["splitSearch", debounced, level]` — as part of the B4-05 fix, not after it.

Regression Tests Required:
- A dom test on `MatchPicker` asserting the query key changes when the level
  changes.

Confidence: HIGH. Source: found during adversarial verification.

---

## Content filter coverage

One row per surface that can render a title. "Source" means the server was asked
for a filtered page (`adultQueryArg` / `$isAdult`); "render" means `isBlocked` /
`blockReason` runs over what arrived. The `blur_adult` column is whether
`shouldBlur` reaches the cover. Taken from the frontend pass's sweep; the
`blur_adult` column and both bell rows were re-read against the working tree.

| Surface | Filters where | blur_adult | Note |
|---|---|---|---|
| MediaList | render — `blockReason` `:321` | yes — `:908`, `:938` | |
| Dashboard (all sections) | render — one filtered base `allAnime`/`allManga` `:78-94` | yes — `:255` | |
| Search | **both** — source `adultQueryArg` `:231` and render `:251` | yes (via `MediaCard`) | renders `FilteredNotice` |
| Seasonal | **both** — source `:61`, render `:70` | yes (via `MediaCard`) | |
| SeasonHero | **both** — source `:45`, render `:53` | yes — `:113` | |
| Calendar | render — `:108`, `:141` (`AiringSlot` carries `isAdult genres`) | **no** — B4-06 | `Slot.media` types `isAdult` away at `:56` |
| AnimeDetail | render — `:157` plus explicit reveal; relations `:221`; lightbox gated on `!veiled` `:283` | yes — `:207` | |
| Franchise | at graph build — `franchise.ts:122` | n/a | no cover art |
| CommandPalette | render — `:121` | **no** — B4-06 | two keystrokes from every screen |
| Statistics | render — `:194`/`:218`/`:264`, plus `isBlockedGenre` `:540`/`:543` | n/a | |
| Wrapped | render — `:673`/`:677`, plus `isBlockedGenre` `:733` | n/a | |
| LocalLibrary | render — `:142`/`:196`/`:212`/`:227`/`:296`, including AniList suggestions | **no** — B4-06 | |
| MatchPicker | render only — `:119-122`, `:136` | **no** — B4-06 | source arg omitted — B4-05 |
| SeasonSplitModal | render only — `:112-115`, `:126` | n/a | source arg omitted — B4-05 |
| UserProfile favourites | render — `:293-294` | n/a | |
| UserLists | render — `:66` | yes — `:162` | |
| ActivityFeed / Activity | render — `:81` / `:39` | **no** — B4-06 | |
| MediaStrip (Person, detail) | render — `:24` | yes — `:51` | |
| FavouritesModal | deliberately not dropped — `:44-51` | `row.adult && blurAdult` `:238` | equivalent to `shouldBlur`; see Refuted |
| Bell — Karasu rows | write time only, in Rust | n/a | not re-checked at render — B4-04 |
| Bell — AniList rows | **none** | n/a | the query selects no `isAdult`/`genres` — B4-03 |

Supporting facts re-checked: the Rust alert passes filter before they speak
(`airing.rs:197`, `:218-223`; `sequel.rs:208-213`; `stale.rs:91-95` with the named
test at `:189-193`); `shouldBlur` (`contentFilter.ts:110-118`) returns false
whenever `blurAdult` is false, at every level, and `contentFilter.test.ts:151-154`
pins that; `adultVars`'s absent-vs-null contract is pinned by
`src/lib/adultVars.test.ts` including the JSON round trip, and all four queries
declaring `$isAdult` spread it.

## Verified sound

Kept from the frontend pass; these record what was covered and found correct.

**Event-listener lifecycle.** Every `listen` call site except `auth.ts:128`
(B4-12) returns a cleanup that *awaits the registration promise*, which is the form
that survives an unmount beating the IPC round trip: `NowPlayingCard.tsx:108-116`,
`GlobalKeys.tsx:74-78`, `Bell.tsx:228-231`, `useNotifBadge.ts:32-35`,
`useAniListLogin.ts:37-46` and `App.tsx:99-105` (`onOpenUrl`). `useNowPlaying.init`
needs no cleanup because a module-level `initialized` flag makes it run once. DOM
listeners balance: 34 `addEventListener` against 30 `removeEventListener`, and the
four unmatched are module-level singletons that must outlive any component —
`theme.ts:295` (media query), `useBackClose.ts:12` (the one `popstate` listener)
and the two global error reporters in `main.tsx:41`/`:44`.

**Timers.** `useSyncStatus`'s one-second poll is gated `enabled: open && isTauri`
and its only consumer passes the panel's open state (`SyncPanel.tsx:107`), so
nothing polls in the background; `refetchIntervalInBackground` is left at its
default so it also stops when the window is hidden. The two 10-minute intervals
(`Bell.tsx:267`, `useNotifBadge.ts:43`) share one query key, so they add an
observer rather than a second request. `useCountdown`, `PlaybackError`,
`useListSummary`'s 60 s relative-time tick and `usePresence`'s exit timer
(including cancel-on-reopen) all clear on cleanup, and `stores/toast.ts` clears its
one module-level timer before every re-arm. *Corrected by verification:* three
confirmation flashes do not — see B4-17.

**Zustand selector discipline.** Selectors return values the store already holds by
reference; the one place that must derive does it in a `useMemo` outside the
selector, with a frozen `EMPTY_CATEGORIES` constant for the empty case and a
comment recording the measured "Maximum update depth exceeded" that forced it
(`auth.ts:69-97`).

**Memoization vs. prop stability.** `GridCard` and `ListRow` are `memo`'d and every
handler `MediaList` passes them is a `useCallback` with correct deps —
`toggleSelect` `:183`, `quickSave` `:455`, `complete` `:463`, `plusOne` `:474`,
`startEdit` `:480` — so no inline lambda defeats the memo. `blurred` is computed by
the page and passed as a boolean specifically so a `useContentFilter` subscription
inside the card cannot re-render hundreds of them (`GridCard.tsx:34-41`).

**Query-key growth on typing.** Search debounces 500 ms into a separate `term`
state and gates on `enabled: … && active`, so keys are minted per settled term, not
per keystroke. The three entity scopes receive the same debounced term and gate on
`USER_SEARCH_MIN`. `MatchPicker` and `SeasonSplitModal` both debounce 350 ms.
Genre/tag multi-selects go into the key encoded by `lib/multiFilter`'s `encode`,
which sorts, so picking the same two genres in either order is one entry.

**Documented invariants, re-verified.** `usePrimedLists` still backdates with
`{ updatedAt: 0 }`. `RecommendedSection` still sorts `seedIds` numerically before
using them as a key. The `scrobble-done` listener still reads the media type from
the store at fire time and still keeps the broad-key fallback. The status-tab
underline is still row-aware with the `+14` last-row offset and a `ResizeObserver`.
`DigestRow`'s trailing block is still `min-w-0`, not `shrink-0`. The cover grid is
still `repeat(var(--cover-cols, 8), minmax(0, 1fr))` written from the theme store.

**UI-vs-backend command coverage.** Every one of the 109 distinct command names the
frontend invokes resolves to a handler registered in `generate_handler!`, and every
registered handler is named somewhere in `src/` — no orphaned setting in either
direction. Every `get_*` a settings pane loads at mount is an infallible Rust `fn`
returning a plain value rather than a `Result` (`prefs.rs:21`/`80`/`97`/`120`/`155`,
`playback.rs:48`/`79`/`198`/`328`, `system.rs:115`/`140`/`211`/`561`/`615`,
`update.rs:54`/`81`, `auth.rs:71`), so the several `.then(setX)` loads written
without a `.catch` cannot in fact strand a pane on a never-resolving state.

**Error branches on the main pages.** `MediaList` (`:615`, `:624`), `Dashboard`
(`:123-128`, with the comment recording that an errored query has
`isLoading === false` and would otherwise render "you have watched nothing" as
settled fact), `AnimeDetail` (`:146-152`), `Statistics` (`:337-342`), `Seasonal`
(`:120-126`), `Calendar` (`:250-251`), `Franchise` (`:199-201`), `ActivityFeed`
(`:65-71`) and `UserList` (whose docstring records that an error used to throw away
every loaded page) all render an explicit failure state.

**i18n.** No hardcoded user-facing English in JSX — the only English string
literals outside `t()` are `App.tsx`'s `PAGE_LABELS`, which are Discord presence
values sent to an external service and deliberately not translated.
`listActivityVerb` returns a closed union mapped through a literal switch in
`ActivityCard.tsx:47`; `relationBadgeKey` returns a two-member key union mapped at
`ProfileHeader.tsx:88-90`; all twenty site-notification labels are literal
`t("notif.…")` cases (`Bell.tsx:125-162`). `lib/format.ts` gives `formatLabel`,
`mediaStatusLabel` and `sourceLabel` a `KNOWN` set plus a `titleCase` fallback, so
an unrecognised AniList enum never renders as a raw key. Dates and numbers are
locale-aware: `fuzzyDate` and `relTime` use `toLocaleDateString(lang)`, and
`narrow()` builds a cached `Intl.NumberFormat` per language with a `try/catch`
fallback to `"en"`. Every plural count except B4-09 is selected by an explicit
ternary, which is the shape `i18nKeys.test.ts`'s `TERNARY` regex can see.

**Routing and overlays.** `SessionExpired` is rendered once, above the split, and
returns null unless `expired && mode === "anilist"`, so it cannot stack.
`lib/backStack` keeps the overlay back-gesture protocol net-zero on history: one
same-URL push per overlay, one popstate listener, a one-shot swallow when closing
by other means, and it declines to pop when a navigation has buried the entry.
`useDialogFocus` traps Tab, stands down when an inner overlay owns focus
(`owner !== mine`, `:86-90`), and defers the focus restore by a microtask because
removing the focused node resets `activeElement` to `<body>` — with the comment
recording that this was measured. `GlobalKeys` and `useGridRoving` both check
`[data-overlay]` before acting. `useViewTransitions` attaches its click listener in
the capture phase so react-router's `Link` has not yet called `preventDefault`,
attaches a `.catch` to the browser-created `ready` promise, and declines to
intercept at all under reduced motion. The `ErrorBoundary` is keyed on the route
and sits inside `<main>`, so navigating away from a page that threw resets it while
the titlebar, sidebar and toast stay alive.

**Everything else checked and found correct.** `useAniListLogin`'s double-tap guard
is a ref, not state, so it holds within one event-loop turn. `useManualSync`'s
re-entry guard is likewise a ref (`busy.current`), so a held Ctrl+R cannot stack
syncs. `useListSummary` subscribes with `enabled: false`, so the sidebar's two
numbers cost zero requests. `useCachedEntry` no-ops in AniList mode and only
fetches in local mode, where the read is SQLite over IPC. `stores/contentFilter`
reverts the level *and* the blur flag on a failed write, and is the one store that
keeps an error. The notification table is bounded at 500 rows on write and read 100
at a time, so the un-virtualized bell list is bounded by construction. Every
paginated list uses a button; there is no `IntersectionObserver` in `src/`, which
is the Conventions rule about the ~30/min limiter.

## Refuted during verification

- **B4-14 — `FavouritesModal` blurs on `row.adult && blurAdult` and ignores the
  level.** Not a defect. `FavouritesModal.tsx:238` is exactly what
  `shouldBlur(media, level, blurAdult)` answers for the same inputs:
  `contentFilter.ts:114` returns false whenever `blurAdult` is false, at every
  level, and `src/lib/contentFilter.test.ts:151-154` ("respects the setting at
  every level, not just off") pins that on purpose. The proposed fix
  (`blurAdult || level !== "off"`) would blur artwork for a user who has explicitly
  switched blurring off, contradicting both that test and the store's documented
  "independent of `level`" contract (`stores/contentFilter.ts:12-16`). The residual
  — an adult favourite is visible in the reorder modal at `strict` — is the direct
  consequence of the deliberate never-drop-a-row decision at `:44-51` combined with
  the user's own blur setting.

## See also

Two findings from the same pass are performance-shaped and are reported in
`PERFORMANCE.md`: the local library rendering one full `LibraryRow` per indexed
title with no virtualization (`src/pages/LocalLibrary.tsx:451-454`, downgraded to
P3), and `useManualSync`'s trailing `invalidateQueries` costing more requests than
its docstring claims (`src/hooks/useManualSync.ts:58-60`, downgraded to P4).
B4-01's account-isolation half is owned by `ACCOUNT_ISOLATION.md` as A3-01.

## Counts

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 1 |
| P3 | 5 |
| P4 | 10 |
| Refuted | 1 |

Sixteen findings, none of them a release blocker. The heaviest is B4-01, a cache
that outlives the account it belongs to; below it sit two content-filter gaps on the
bell, five cover surfaces that ignore `blur_adult`, a grid cursor that moves without
scrolling, one ungrammatical count string and a cache patched by mutation. The
remaining ten are consistency, documentation and accessibility work.
