# Changelog

Notable changes to Karasu, newest first.

Format loosely after [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions are `MAJOR.MINOR.PATCH.COMMIT#`, where the fourth segment is a commit
counter that moves on every commit (see `CONTRIBUTING.md`).

**There has been no tagged release yet.** Everything published so far went to
the rolling `latest` prerelease, which is force-moved on every push to `main`,
so there is nothing under a version heading below to compare against. The first
tagged release will close the `Unreleased` section rather than adding to it.

**Cutting a release reads this file.** `scripts/release/release-notes.ps1`
slices the section between `## <version>` and the next `## `, and *throws* if
there isn't one — a release published with an empty body is not something
GitHub complains about, so the script does. So before pushing `v1.0.0`:

1. rename `## Unreleased` to `## 1.0.0` (a trailing ` — 2026-08-15` is fine,
   the match only needs the version to come first),
2. open a fresh empty `## Unreleased` above it,
3. delete the paragraph above this one, which stops being true at that point,
4. and make sure `package.json` already says `1.0.0` — the workflow refuses a
   tag whose version disagrees with the commit it points at.

Commit subjects are the real record and are written to be read; this file is the
short version, grouped by what it means for someone using the app.

## Unreleased

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

### Added

- Karasu's own bell rows open the title they are about, the way the AniList rows
  beside them already did. Rows from before this update carry no title to open
  and behave as they always have.
- Detection corrections: tell Karasu which entry a detected title really is, and
  which episode number that season starts at.
- Position-aware scrobbling — Jellyfin's playback position and a direct mpv IPC
  probe, so progress is written where you actually are in the episode.
- Reviews on the detail page, with a composer that knows AniList's rules.
- AniList's own notifications in the bell, beside Karasu's.
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
