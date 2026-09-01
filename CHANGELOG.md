# Changelog

Notable changes to Karasu, newest first.

Format loosely after [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions are `MAJOR.MINOR.PATCH.COMMIT#`, where the fourth segment is a commit
counter that moves on every commit (see `CONTRIBUTING.md`).

**There has been no tagged release yet.** Everything published so far went to
the rolling `latest` prerelease, which is force-moved on every push to `main`.
The workflow publishes tagged `v*` releases too — none has been cut yet, which
is why there is nothing under a version heading below to compare against. The
first will close the `Unreleased` section rather than adding to it.

**Cutting a release reads this file.** `scripts/release/release-notes.ps1`
slices the section between `## <version>` and the next `## `, and *throws* if
there isn't one — a release published with an empty body is not something
GitHub complains about, so the script does. So before pushing `v1.0.0`:

1. rename `## Unreleased` to `## 1.0.0` (a trailing ` — 2026-08-15` is fine,
   the match only needs the version to come first),
2. open a fresh empty `## Unreleased` above it, carrying a
   `<!-- generated-through: <sha> -->` marker so the generator knows where to
   resume,
3. delete the paragraph above this one, which stops being true at that point,
4. and make sure `package.json` already says `1.0.0` — the workflow refuses a
   tag whose version disagrees with the commit it points at.

Commit subjects are the real record and are written to be read; this file is the
short version, grouped by what it means for someone using the app.

**How this file is maintained: by `scripts/changelog.mjs`, not by hand.**
Keeping two records of the same work in step by hand is the kind of chore that
gets skipped under pressure, and skipping it silently is worse than not doing
it — a half-updated changelog reads as complete. So the `Unreleased` section is
generated from the commits.

    node scripts/changelog.mjs           # bring it up to HEAD
    node scripts/changelog.mjs --check   # is anything undescribed?

The `<!-- generated-through: <sha> -->` marker in that section records how far
it has read; the script only ever appends past that point, so anything already
written by hand survives and a second run is a no-op. What makes the output
readable is that commit subjects here are prose, written to be read — a
conventional-commits parser would have had nothing to work with. A commit that
deserves a better line than its subject says so in a trailer:

    Changelog: Fixed: A declined update no longer re-downloads every day.
    Changelog: skip

Version-only commits and changes confined to docs, CI or scripts are left out
without needing the trailer.

It is kept rather than deleted for two concrete reasons:

1. **`scripts/release/release-notes.ps1` throws without it.** No `## <version>`
   section, or an empty one, and the tag build fails by design — a release
   published with an empty body is not something GitHub complains about, so the
   script does. The file is load-bearing at tag time whether or not it is
   pleasant to maintain.
2. **It is not the same artefact as the log.** Four hundred commit subjects
   ordered by when they happened, several of them internal, is not what someone
   deciding whether to update wants to read. This is grouped by what changed for
   *them*.

So the policy is: the section is generated, and the writing that matters
happens in the commit subject — or in a `Changelog:` trailer when the subject
is about the change and the reader needs to hear about the effect. Curating at
tag time is then optional rather than load-bearing.

## Unreleased

<!-- generated-through: 189d4e2 -->

### Fixed

- **Account-free mode no longer wipes an entry when you edit one field of it.**
  Every quick control — `+1`, the status dropdown, the score select, the bulk
  bar, the detail editor — sends only the field you changed, and the local list
  was filling in the rest with defaults: a `+1` reset the status to Planning and
  zeroed the score, repeat count, volume count, notes and tags. Absent now means
  "leave it alone" for every field, as it always has for AniList.
- **The sign-in merge no longer deletes local rows it never pushed.** A local
  entry that agreed with AniList on status, progress and score was cleared
  without being sent — so notes, tags, rewatch count, volume count, privacy and
  both dates that existed only locally were lost, and the merge reported
  success. It now pushes whatever the AniList row is missing before clearing,
  and never overwrites a value AniList already has.
- **A library scan can no longer wipe the index because the drive was offline.**
  An unreachable folder produced zero files, and zero files were written down as
  the truth across all three library tables — reported as a successful scan, and
  surviving a restart. The folder is checked before anything is replaced, and
  finding nothing where something was indexed before keeps the index and says so.
- **Queued offline edits can no longer land on a different account.** Signing out
  left them in the database with no record of who made them, so the next account
  to sign in drained them onto its own list. Each queued edit is now stamped with
  the account that made it and is only ever replayed for that account — so
  signing back in still syncs what you were waiting on, and nobody else's client
  ever sees it.
- **The JSON backup carries every list field again.** It dropped advanced
  scores, custom-list membership and hidden-from-status-lists — the three that
  AniList writes wholesale with no undo, and so the three a backup is most
  needed for.
- **Undo is no longer offered for a save it cannot reverse.** It covered six
  fields and silently skipped the rest; it now reverses dates, privacy and
  hidden-from-status-lists too, and declines outright when a save touched custom
  lists or advanced scores.
- **The score rescale reads the list as it is now**, not as it was when you
  opened Settings — it could claim there was no list at all, and otherwise
  planned real score writes from a stale snapshot.
- A daily backup that was truncated (a full disk, a process killed mid-write) is
  checked and rewritten instead of occupying a retained slot unusably.
- **Clicking the tag box no longer deletes a tag.** A `<label>` around the tag
  editor made the first chip's remove button its target, so clicking the caption,
  the box's padding, or another chip's text removed the first tag silently.
- **The list view's keyboard shortcuts no longer fire against the wrong entry.**
  After one arrow press, Enter/Space/e/c/s acted on the highlighted row whatever
  else had focus — Space on a focused button wrote a `+1` to your real list for a
  title you weren't looking at, and cancelled the button you actually pressed.
- Ctrl+K no longer opens the command palette behind an open editor and discards
  what you were typing; the season picker no longer lets `/` and Ctrl+1/2/3 fire
  underneath it.
- **The Stable update channel no longer claims you are up to date.** No stable
  release has ever been published, so its manifest 404s — and a manual check
  answered that with a green tick. It now says the channel has no release yet.
- An update check that fails no longer burns the once-a-day throttle, and the
  request has a timeout like every other one in the app.
- Switching update channel clears the download held for the old one, instead of
  offering to install a build the new channel does not have.
- On Linux, an update is only offered to a running AppImage. A self-built binary
  was offered one whose install would have overwritten the user's own build.
- **Settings that failed to save no longer look saved.** The content filter and
  every detection toggle were fire-and-forget: the switch moved, the write was
  dropped, and the choice quietly did not survive a restart. They put the
  control back and say what went wrong.
- The bell no longer answers a failed read with "You're all caught up."
- The media-session diagnostic distinguishes "no player is reporting anything"
  from "the system service could not be reached" — on Linux the second means
  detection is down, and it used to send you to debug your player.
- Turning airing notifications off no longer arms them: re-enabling months later
  used to replay every episode that had aired in between.
- A title hidden by the content filter can no longer surface in an on-hold
  reminder.
- **"No such user" is no longer what a dropped connection looks like.** Profiles,
  threads and character/staff pages rendered every failure as "this does not
  exist" — a definite claim about someone else's account, made because the
  network was down. A real not-found still reads as one; everything else says
  what failed and offers a retry.
- Relative timestamps ("3m", "5h", "2d") are translated. They were hardcoded
  English sitting directly beside a translated "now"; German now reads 3 Min. /
  3 h / 3 T.
- The franchise graph's status legend uses the right vocabulary — it said
  "Watching" over a manga graph whose own cards said "Reading".
- Jellyfin's sign-in errors are translated. "Wrong username or password" was
  composed in Rust and printed verbatim, so a German UI showed it in English.
- **Five things that were reading or writing the wrong cache entry.** The
  sidebar's Anime and Manga counts were blank for the whole of account-free mode
  and the franchise rail could not see a local entry (both keyed on `undefined`
  where every other screen keys on `0`); the favourite heart on a character,
  staff or studio page patched a *media* entry keyed by a character id and never
  moved; liking a thread updated nothing on screen; and the thread author's
  avatar was always missing, because the query asked for a size the page does
  not read.
- Fetching media in bulk no longer fires every batch at once into a shared
  ~30/min budget.
- Portable mode's "replace the database that's already there" works. It called
  a copy that refuses an existing file, so it could only ever print a raw SQLite
  error — the only route to a portable copy was deleting the old file by hand.
- Two list screens opening at once no longer each send the whole offline queue,
  and a queued edit AniList refuses outright now says so instead of vanishing.
- The trailer card and the streaming-episode tiles no longer render as broken
  images. Their thumbnails live on hosts the content-security policy does not
  allow, and widening it to cover them would hand those hosts your IP and what
  you are looking at — so the cards are drawn instead, and still open the same
  link.
- The command palette's keyboard cursor follows the list. Twelve navigation
  items do not fit its box, so the last one was unreachable: arrowing down moved
  an invisible highlight and Enter opened something never on screen. It also
  announces the highlighted row to a screen reader now.
- On Linux, mpv's IPC socket defaults to your own runtime directory rather than
  a `/tmp` path shared with every other account on the machine.
- The detail page's play button appears as soon as a library scan finds the next
  episode, instead of waiting for something else to redraw the page.
- An episode that has just aired no longer shows an empty pair of brackets where
  its countdown was.
- The franchise graph says when it stopped expanding, instead of only when it ran
  out of room for nodes.
- The match picker shows "TV Short" rather than `TV_SHORT`.
- The context menu takes focus when it opens and announces itself as a menu, so
  it can be used from the keyboard at all.
- Grid-card buttons become visible when tabbed to, instead of being focusable
  while fully transparent.
- The review composer's body label no longer points at a field that isn't there
  in preview mode.
- An offline edit is no longer deleted when AniList answers with something
  recoverable — an expired token, a rate limit, a server fault. Only a payload
  AniList rejects on its own terms is dropped, and when one is, it says so.
- Repeated offline edits to the same entry collapse instead of replaying as one
  request each into a ~30/min budget.
- The sign-in merge refuses to run unless it has read both live AniList lists
  first. A failed read used to look like an empty account, at which point the
  local list was pushed over real progress.
- A merged entry whose write only reached the offline queue keeps its local row
  until the write lands.
- Enabling portable mode with a database already beside the executable asks
  which copy to keep instead of silently adopting the older one. Disabling says
  which database it is going back to.
- A panic in a background loop can no longer poison a lock and take detection or
  the alert passes out for the rest of the session.
- A failed request stops reading as an empty result: Wrapped, the recommendation
  sections and activity replies say the request failed rather than showing an
  empty year, a missing section, or "no replies yet".
- A bulk edit that stops partway reports how much it wrote, and the list
  refetches instead of rolling back entries AniList has already changed.
- A scrobble can only ever move progress forward; "Update now" from a blocked
  session can no longer write episode 1 over episode 27.
- A season Karasu cannot place is refused with the sequels offered, rather than
  guessed at against season one.
- One slow Jellyfin response no longer flips the now-playing card to another
  source.
- A paused mpv no longer outranks the thing actually playing.
- Scores got their colour back in the list, and a bio's centred lines render as
  lines.
- **Signing out of one account and into another no longer carries the first
  account's data across.** Queued offline edits, bell rows and the alert dedupe
  keys belong to the account that made them; the queue could drain one
  account's unsent edits onto another's list.
- **A scrobble can no longer overwrite an edit you just made.** Every write
  path keeps the cached list in step, which is what the scrobbler reads to
  decide whether progress moved backwards.
- **A queued edit is no longer reported as a saved one.** An edit that can only
  be sent later says so, instead of showing a green receipt and a progress bar
  that had not moved on AniList.
- **A deleted entry stays deleted.** It used to remain a scrobble candidate,
  and playing that title recreated the row.
- **A paused player stops the clock.** Detection reads the audio session, so an
  episode left paused mid-watch is no longer eventually written as watched.
  Windows only — the other detection sources already reported their own play
  state.
- **A database that will not open falls back to the newest daily backup**
  rather than blocking the app whose only recovery path runs through it.
- **A declined update stops re-downloading itself.** It fetched the whole
  installer again every 24 hours and announced the same release each time. A
  clock pushed backwards no longer disables update checks either.
- The local library only renders the rows on screen, so a large collection
  opens without the pause.
- The background notification check reports it when Android refuses to register the job, instead of showing a schedule that does not exist.

### Added

- Arrow keys move a cursor across the Seasonal and Search grids, and Enter opens
  the highlighted title — the same movement the list view has had.
- A clear button in the search and filter boxes — Search, the list filter, the
  forum search, the unplaced-titles filter and the filter dropdowns.
- The sidebar collapses to icons, and remembers it. The button sits below the
  navigation; collapsed, every icon keeps its name as a tooltip, the group
  headings become dividers, and an unsent-changes dot stays on your avatar.
- Karasu's own bell rows open the title they are about, the way the AniList rows
  beside them already did. Rows from before this update carry no title to open
  and behave as they always have.
- Detection corrections: tell Karasu which entry a detected title really is, and
  which episode number that season starts at.
- Position-aware scrobbling — Jellyfin's playback position and a direct mpv IPC
  probe, so progress is written where you actually are in the episode.
- Reviews on the detail page, with a composer that knows AniList's rules.
- AniList's own notifications in the bell, merged with Karasu's into one
  stream (the grouping is presentation only — `lib/notifGroups`).
- Export: MAL XML per medium and Karasu's own JSON; MAL import into the local
  list; a daily local database backup.
- A global hotkey, a real tray menu, and a working button on the scrobble
  confirm toast.
- Statistics: Ratings, Years and themed tabs, all charts drawn here.
- The whole app reads, edits and charts in the account's own score format.
- Search filters, sorting and paging, which makes it the browse page.
- Custom list membership per entry; entry dates, privacy and repeat count.
- A one-pass score rescale that prints the request count before it runs.
- The airing week exports to any calendar app.
- Profiles gained a Lists tab with an affinity score.

### Changed

- An aired episode no longer arrives twice. When your AniList account raises its
  own airing notification, Karasu still shows the desktop notification — the one
  thing the website cannot do while Karasu sits in the tray — and leaves the bell
  row to the AniList tab, where it opens the entry. Turn AniList's off and Karasu
  writes that row itself, as before. Both settings say so, on both screens.
