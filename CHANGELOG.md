# Changelog

Notable changes to Karasu, newest first.

Format loosely after [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions are `MAJOR.MINOR.PATCH.COMMIT#`, where the fourth segment is a commit
counter that moves on every commit (see `CONTRIBUTING.md`).

**Cutting a release reads this file.** `scripts/release/release-notes.ps1`
slices the section between `## <version>` and the next `## `, and *throws* if
there isn't one — a release published with an empty body is not something
GitHub complains about, so the script does. So before pushing a `v*` tag:

1. rename `## Unreleased` to `## <version>` (a trailing ` — <date>` is fine,
   the match only needs the version to come first; brackets around it or a
   fourth dotted segment break the match and the tag build throws),
2. open a fresh empty `## Unreleased` above it, carrying a
   `<!-- generated-through: <sha> -->` marker so the generator knows where to
   resume,
3. and make sure `package.json` already says the same version — the workflow
   refuses a tag whose version disagrees with the commit it points at.

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

<!-- generated-through: 2f8cbc2 -->

### Fixed

- Pinning an activity no longer signs you out; a refusal shows AniList's reason, and the pin control is only offered on accounts that can pin.
- Spoilers that wrap several paragraphs, lists or images now hide as one block, and comment previews no longer reveal spoiler text.
- Images in bios and forum posts that showed as a link now render — linked badges, <img> tags, URLs with parentheses, and hosts that mislabel the file — and each is fetched once.
- Bios and posts render as anilist.co does where they did not — a favicon-style ICO image loads inline, every HTML entity a browser knows is decoded, a heading written as #Title without the space is a heading, ~~~centred~~~ text inside a heading keeps its spoiler, <hr> draws a rule, and a one-line centred row starting with a dash is no longer a bulleted list.
- With Karasu on both the PC and the phone watching the same Jellyfin account, an episode reaches AniList once — the desktop goes first, the phone waits three minutes and checks, and every instance asks AniList for the current progress before it writes.
- Find servers now reaches the Jellyfin server on a PC with a virtual network switch (Hyper-V, VirtualBox), which the first version missed.
- New-episode and sequel checks keep working through an AniList outage that refuses anonymous requests, by signing them with your account while you are signed in.
- A link with a target Karasu refuses (javascript:, data:, AniList's layout blob) now shows in the accent colour like on anilist.co, instead of as plain text.
- A pinch on Android no longer zooms the whole screen; the interface size under Appearance is the one zoom.
- The sidebar collapses to icons on a short window instead of pushing its lower entries out of view.
- Restarting Karasu right after it spent its AniList budget no longer fires a burst of requests into the limit.
- The twice-daily sequel check spreads its requests out instead of sending them in one burst.
- The now-playing ring no longer restarts on a card mounted mid-session (1.10.3.620).
- An AniList profile link that carries the user's id, as the Statistics header's does, opens the profile in-app instead of "No such user".
- Reading notifications one by one now clears the bell's badge, and "Mark all read" is always available.
- A pull-to-sync gesture could fail to arm when two touch events arrived in the same frame.
- A pull-to-sync left mid-way by a navigation no longer leaves its hint on the next screen, and a long press no longer selects the action sheet's title.
- A release name that carries the episode's title after its number now parses the number, and Jellyfin's episode name reaches the now-playing card.
- The command palette's result groups are announced as groups, and its input has a name.
- F5, Ctrl+F and Ctrl+P no longer reach the browser engine under the app on desktop; copying works the same on Linux as on Windows.
- The Linux AppImage no longer opens a black window with EGL_BAD_PARAMETER on Fedora 44, Ubuntu 26.04 and other systems with Mesa 26.
- Panning the franchise view on Android no longer triggers a sync, and the view opens centred on the title it was opened from.
- A saved preset now remembers the custom list it was filtered to.
- The franchise page no longer scrolls sideways on a phone, and its legend names every status.
- Episode, chapter, volume and rewatch fields no longer keep a 0 you cannot delete, and an emptied field saves as 0.
- Text in the phone's More sheet, the bell, the filter menus and the calendar uses its intended colour instead of inheriting the one above it.
- The status editor and the list's panels stay inside a short window instead of running off its bottom.

### Added

- A formatting toolbar in every place you write on AniList — activities, replies, threads, comments, reviews and your bio — with shortcuts for bold, italic, strikethrough and spoiler.
- On Android, Jellyfin tracking can keep running with the screen off — a switch under Detection → Jellyfin starts a quiet permanent notification that stops Android from freezing the app, a button excludes Karasu from battery optimisation (which also keeps the notification check on schedule), and the tracking settings are no longer greyed out there.
- Settings → Detection → Jellyfin can find the servers on your network by name, and signing in checks the address is a Jellyfin server before your password is sent.
- Jellyfin settings take an optional external address for when the server is not reachable at the first one — Karasu switches over by itself, checks it is the same server before sending anything, and Test connection says which address answered.
- An "Interface size" setting under Appearance zooms the whole window (75–200 %), for 4K displays and TVs across the room.
- Ctrl+plus, Ctrl+minus and Ctrl+0 change the interface size, like in a browser, and the size sticks.
- The calendar has three views (week grid, tiles, agenda) and never scrolls sideways; "My shows" keeps the episodes that already aired, dimmed; a Density setting under Appearance sizes the calendar, the local library and the digests.
- The sync panel and the diagnostics report show AniList requests per source since the app started.
- Detail, seasonal, franchise and similar pages are cached on disk with a per-page lifetime, so reopening one after a restart usually costs no request.
- Android downloads a new version by itself over Wi-Fi and opens the installer from About or the bell.
- Android shows the update's download and installs it from About, the bell, or once at start; the update channel is now reachable there too.
- The window opens where and how large it was last closed.
- On Android, a long press and an armed pull-to-sync give a short haptic tick, and a title can be shared to another app from its menu or its page.
- Appearance can follow the system's accent colour on Windows, GNOME/KDE and Android 12+, with your own colour kept for when you switch back.
- Linux releases ship a .deb and an .rpm beside the AppImage; the AppImage remains the one that updates itself.
- Setting a title to Completed now fills in the final episode or chapter (and the volume count for manga) wherever the status changes.
- A third, text-only list view beside the gallery and thumbnails, and all three views on the phone, laid out for its width.
- On the phone, swipe left or right on the anime and manga lists to move between the status tabs.
- A contrast setting under Appearance: System, Standard or High, where High lifts text, the accent and every border to at least 7:1 in both themes.

### Changed

- The Android battery hint says which vendor setting keeps tracking alive with the screen off (nubia/ZTE: "Runs in background" → "Allowed").
- Your list is read from the local copy for fifteen minutes after a fetch and refreshed quietly in the background after that; "Sync now" still fetches at once.
- Karasu now waits for the next episode's airing time instead of polling AniList every twenty minutes for new episodes.
- The Wrapped page is built from the list Karasu already holds, and saving from a title's page no longer reloads it.
- Exit cleanly when Windows ends the session; the quit panic was never the tray (1.10.4.621).
- Every sync surface shares one lock, so a sync started elsewhere shows as running.
- Pulling a screen down on the phone syncs, and Android drops the sync row (1.12.0.629).
- Long-pressing a title on touch opens what can be done with it (1.13.0.631).
- Swiping up from the bottom bar opens the command palette (1.14.0.632).
- Right-clicking a title offers what can be done with it (1.15.0.633).
- Detection floats over every screen, expanded or compact (1.16.0.634).
- Four defects the adversarial pass found in the interaction work (1.16.2.636).
- On the phone the list header no longer shows a reload button; pull the list down to sync.
- The now-playing card is a small floating window with the cover, season and episode, the episode's name and the AniList details; on desktop it can be dragged anywhere and resized, and remembers both.
- The now-playing window's update, skip and fix-match buttons sit in its header.
- Banners on title pages, profiles and the season hero are shown whole instead of cropped, with a blurred fill around them, and the hero's text has a black outline.
- The anime and manga list header is rebuilt: single-row status tabs in their status colours, and one toolbar with search, sort, filter and preset panels, removable filter chips, and a More menu on the phone.
- Banners blend into their surroundings without hard edges, the title page's banner takes less room on the phone, and the Overview hero counts aired episodes for a running show.
- Swipe the season hero instead of stepping it with arrows (1.22.2.675).
- On the phone, the detail page puts every fact below the cover and lets you change the status from a button.
- The detail page edits your entry from the status button, and the score bars show how everyone else scored the title.
- A calmer, sharper look: neutral hairlines, tighter corners, headings and labels in the Karasu typeface, and sheets and dialogs that arrive on a soft spring.
- Every control shows the same focus ring when reached by keyboard, controls sink slightly while pressed, and small buttons are easier to tap on a touch screen.
- Settings switches keep a readable thumb on pale accents and show their edge in high contrast.
- Expandable sections open and close with a short height animation instead of jumping.
- Chips and counts share one look across the app: outlined labels and one badge shape.
- View switches slide to the chosen option and follow the arrow keys; statistics sections use the list's tab strip.
- The right-click menu finds entries by typing, keeps its submenu open on the way to it, and stays on screen at any edge.
- Bottom sheets on the phone can be swiped away and sit above the bottom bar.
- Receipts can be flicked away, stay put while hovered or focused, and give an Undo seven seconds.
- menus, sheets and panels share one row, with 44 px touch targets on the phone.
- every dialog shares one frame; buttons stay in reach on short windows and the confirm fits a phone.
- every search field looks and clears the same way.
- form fields, choices and notes share one frame.
## 1.0.0 — 2026-09-05

Karasu 1.0.0 is the first tagged release: a desktop and Android tracker built
exclusively for AniList, in the spirit of Taiga. It watches what you play or
read — the system's media sessions on Windows and Linux, player and browser
windows on Windows, and a Jellyfin server anywhere — parses the release name,
matches it against your list and scrobbles the progress, asking first when it
is not sure. Around that sit the list itself with offline editing and a sync
queue, a local library scanner that knows which episode you have on disk,
statistics and a year-in-review poster, AniList's forum and activity feed,
and on Android four home-screen widgets and background notifications that
run with the app closed.

This release also opens the **Stable** update channel: new installs follow it
by default, and the per-commit build lives on as **Nightly** for anyone who
wants to stay on the edge. Everything below is what changed on the way here,
grouped by what it means for you rather than by commit; the full record is
the commit log.


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
- A title's page now shows what your list already knows when you are offline, with a working +1, instead of a raw network error.
- Switching AniList accounts no longer carries the previous account's notification cursor along.
- AniList activity permalinks open in Karasu on Android.
- The Android background notification check now actually registers with the system; before, Android had been refusing it silently since the feature existed.
- An anilist.co link that launches Karasu on Android now opens the page it names instead of the dashboard.
- The local library's scrollbar no longer creeps while scrolling into rows it has not drawn yet.
- On Android, "Save report", the poster export and the calendar export write a file instead of leaving an empty one behind.
- Switching update channel no longer leaves the other channel's "ready to install" notice in the bell.
- Sharing a link to Karasu on Android works from apps that share styled text.

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
- The Social tab is now called Activities.
- New installs follow the Stable update channel; the per-commit build is the Nightly channel, and every install that was on it stays there.
