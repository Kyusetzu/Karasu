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
