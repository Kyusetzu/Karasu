# Legal and Content Audit

## Scope

Pre-release legal, content and repository-hygiene review of `/home/user/Karasu`.
The original pass was written at `3381dec`; adversarial verification and the
re-checks behind this report were run at `9a53427` (52 commits, single lineage,
root `c0a95d0`). Everything here is read-only; no file outside this report was
modified.

Covered:

- **Piracy adjacency** — the detection site-marker tables, and a tree-wide sweep
  for feed, torrent and release-group tooling.
- **Real anime/manga titles and fansub group names** in fixtures, tests and
  prose, classified by whether the fixture earns its specificity.
- **Artwork and asset provenance** — the app icon, the crow mark, installer
  bitmaps, and the ten README screenshots (contents and Exif).
- **Third-party platform references** — Plex, Emby, MyAnimeList, Discord,
  Jellyfin, Taiga — checked for nominative use versus implied affiliation.
- **The external URL inventory** and the "no telemetry" claim, traced to the two
  candidate code paths rather than asserted.
- **Repository history secret scan**, read-only, across all refs.
- **Licence completeness** — MIT at the root, `THIRD-PARTY-NOTICES.md`, the two
  bundled fonts, SQLite, the npm and crate trees, and the runtime-fetched
  `anime-relations` dataset.

`CLAUDE.md` was read first and its documented decisions are treated as decisions,
not defects. Two of them bear directly on this dimension and are respected
throughout: the deliberate rejection of RSS/torrent release feeds and anything
piracy-adjacent, and the deliberate choice to proxy bio images through Rust
rather than widen the CSP.

Two verification checks the original pass declared impossible for want of network
access were in fact runnable, and were run: the upstream licence of
`erengy/anime-relations` and the vendor semantics of star-history's
`sealed_token`. Both are recorded in the findings that turned on them.

Ten findings. None is a release blocker. One (C3-09) is a publication decision
that should be made before the branch is merged or the repository is made public.

---

## Findings at a glance

| ID | Severity | Category | File:Line | One-line summary |
| --- | --- | --- | --- | --- |
| C3-09 | P2 | RELEASE HYGIENE | `audit/` (8 tracked files) | Eight internal audit reports — 118 severity-tagged, unremediated findings — are committed and already on `origin` |
| C3-03 | P3 | DOCUMENTATION ISSUE | `src/lib/anilistMarkdown.test.ts:828` | A test fixture names a real, identifiable third-party AniList user and reproduces their bio |
| C3-04 | P3 | DOCUMENTATION ISSUE | `SECURITY.md:53-60` | The enumeration of contacted hosts omits the automatic bio-image fetches to arbitrary third parties |
| C3-01 | P4 | DOCUMENTATION ISSUE | `README.md:89` | A features bullet names five unlicensed scanlation aggregators by name |
| C3-02 | P4 | DOCUMENTATION ISSUE | `README.md:407-409` | An unnecessary opaque `sealed_token` parameter is embedded three times |
| C3-05 | P4 | DOCUMENTATION ISSUE | `LICENSE:1-3` | The unqualified MIT grant nominally sublicenses seven screenshots' worth of publishers' cover art |
| C3-06 | P4 | DOCUMENTATION ISSUE | `THIRD-PARTY-NOTICES.md` (absence) | The runtime-fetched `anime-relations` dataset is absent from the notices file, which structurally cannot see it |
| C3-07 | P4 | IMPROVEMENT | `src-tauri/tauri.conf.json:52` | The bundled notices file has no in-app route from About |
| C3-08 | P4 | MISSING TEST | `src-tauri/src/playback/detection/profiles.rs:63-79` | Eight of ten site markers have no test, so a title-format change breaks detection with a green suite |
| C3-10 | P4 | PROCESS | `audit/` (this report series) | Two findings' confidences were set by an assumed lack of network access that was never tested |

---

## Findings

---

ID: C3-09
Severity: P2
Category: RELEASE HYGIENE

File: audit/ (eight tracked files: `ACCOUNT_ISOLATION.md`, `ARCHITECTURE.md`, `DATABASE_AUDIT.md`, `DATA_INTEGRITY.md`, `SCROBBLING_AUDIT.md`, `SECURITY.md`, `SYNC_AUDIT.md`, `UPDATE_AUDIT.md`)
Line: n/a (whole directory)
Function: n/a

Problem:
The internal pre-release audit reports are committed to the repository and are
already pushed to `origin`. `git ls-files audit` returns eight files totalling
**10,443 lines**, carrying **118 severity-tagged findings** — 1 × P1, 14 × P2,
38 × P3, 65 × P4 — none of which is remediated. They landed in two commits:
`3381dec` added `ARCHITECTURE.md`, `9a53427` added the other seven.
`git ls-tree --name-only origin/claude/karasu-release-audit-l2rksb` lists
`audit`, so the tree is on the remote already.

`audit/SECURITY.md` is an eleven-finding security report that names the exact
files and mechanisms examined — `keystore.rs`, `TokenCipher.kt`, the OAuth
loopback listener, the IPC command surface, the bio-image SSRF proxy, the CSP,
and the updater trust chain. `audit/ACCOUNT_ISOLATION.md:66` carries a P1.
Five further reports (`DEAD_CODE.md`, `DETECTION_AUDIT.md`, `LIBRARY_AUDIT.md`,
`PERFORMANCE.md`, `UI_UX_AUDIT.md`) are on disk untracked at the time of this
check and will follow the same path if the directory keeps being committed —
`DETECTION_AUDIT.md:74` carries a second P1. **This report is itself one of
them.**

Expected Behavior:
A pre-release vulnerability inventory does not enter the public tree ahead of
the fixes it describes, and internal working documents do not enter permanent
public history at all.

Actual Behavior:
Eight of them are tracked, pushed, and included — silently — in the "531 tracked
files" the original audit reported on. No `.gitignore` rule covers `audit/`.

Reproduction:
```
git ls-files audit
git ls-files audit | xargs wc -l                      # 10443 total
grep -h "^Severity: P" $(git ls-files audit) | sort | uniq -c
grep -n "Severity: P[01]" audit/*.md
git log --oneline --name-status -- audit              # 3381dec, 9a53427
git ls-tree --name-only origin/claude/karasu-release-audit-l2rksb | grep audit
```

Impact:
Ordinary and concrete. If this branch is merged, or the repository is made public
with the branch present, a complete unremediated vulnerability inventory becomes
public before the remediation does — a map of where to look, written by someone
who already looked. Independently of the security content, 10,443 lines of
internal working documents enter permanent public history, where removal costs a
history rewrite rather than a delete commit. It is the same
cheap-now/expensive-later asymmetry that motivates C3-03, at roughly a
thousandfold the volume.

Root Cause:
The audit was run inside the working tree and its output was committed with the
same reflex as any other file. Nothing in `.gitignore` distinguishes an internal
working document from a shipped one.

Recommended Fix:
A publication decision rather than a code change. Keep `audit/` out of the
published tree by whichever route the maintainer prefers: add `audit/` to
`.gitignore` and `git rm --cached` the eight files before the branch is merged;
or keep the branch private and never merge it; or move the reports to a private
repository. If the branch has already been shared beyond the maintainer, treat
the security report's contents as disclosed and prioritise the P1 and P2
findings it names accordingly. Deciding before publication avoids the rewrite;
deciding after does not.

Regression Tests Required:
None (repository content). A one-line `.gitignore` entry is self-enforcing, and
`git ls-files audit` returning empty is the check.

Confidence: HIGH — Source: found during adversarial verification

---

ID: C3-03
Severity: P3
Category: DOCUMENTATION ISSUE

File: src/lib/anilistMarkdown.test.ts
Line: 828 (further occurrences at 464, 466, 590; and `src/lib/anilistMarkdown.ts:520`)
Function: `it("renders the fixture profile's shape — the bug that started this")`

Problem:
A test fixture names a real, identifiable third-party AniList user in a code
comment and reproduces the distilled shape of their public profile:

```ts
  it("renders the fixture profile's shape — the bug that started this", () => {
    // Distilled from a real bio (User "cheesxcxke"): entity spacers, centred
    // divs, an h5 with bare-<a> decoration, a linked favicon image.
```

The URLs in the fixture are anonymised throughout — every path is `/x` or `/y`
— which shows anonymisation was applied deliberately and simply skipped the
comment.

A second real profile supplies `~~~ tam | she/her` at three further points:
`anilistMarkdown.test.ts:464` (a comment), `:466` and `:590` (fixture strings),
plus a fourth occurrence in production source at `src/lib/anilistMarkdown.ts:520`
— a source comment, not a test. Those identify nobody by handle and are
materially less exposed, though a first name plus pronouns plus a carrd
subdomain is closer to identifying than it looks.
`src/components/social/Markdown.dom.test.tsx:153-154` shows the right pattern
already: "Distilled from a live profile", no handle.

Expected Behavior:
A public repository's test fixtures do not name third parties who did not
consent to appear in it.

Actual Behavior:
`anilistMarkdown.test.ts:828` names `cheesxcxke` in a comment that GitHub code
search will index the moment the repository is public, alongside the distilled
contents of their profile.

Reproduction:
```
sed -n '826,838p' src/lib/anilistMarkdown.test.ts
git grep -nI -E "cheesxcxke|she/her" -- src
```

Impact:
Small in absolute terms and large relative to the person's stake in it: they are
a stranger whose profile happened to crash a markdown parser. The operative
argument is not legal exposure but timing — the fix is one word today and a
history rewrite once the repository is public.

Two claims from the original write-up do **not** support the finding and are
withdrawn. The `18` in `<div align="center">18<a>&#8593;</a></div>` renders
`18↑`, which is a stock AniList-bio "18 and up" decoration at least as plausibly
as a self-stated age; and the GDPR "processing without a basis" framing is
overreach for a pseudonymous handle the person published themselves, reproduced
in distilled form with URLs stripped. The finding stands on the handle alone,
which is enough.

Verification: substance confirmed at P3; the "stated age" reading and the GDPR
framing removed as unsupported, and a fourth occurrence in production source
added.

Root Cause:
The comment records provenance for a future reader ("the bug that started
this"), which is good practice. The provenance did not need to be the person's
handle when "a real bio" conveys the same thing.

Recommended Fix:
Replace `User "cheesxcxke"` with a non-identifying provenance note — `Distilled
from a real bio: entity spacers, centred divs, …`. The `18` may be left alone or
changed to an arbitrary number; the test asserts on `★`, `center`, `h`, `accent`,
`link` and `chip` and never on that value, so either is inert. Consider the same
substitution for `tam | she/her` at lines 464, 466 and 590 and at
`anilistMarkdown.ts:520`. Because the repository is not yet public this can be
fixed forward — but only until it is published.

Regression Tests Required:
The edits are within tests. Changing the fixture strings at 466 and 590 requires
updating the paired `expect(textOf(...)).toContain("she/her")` assertions at 468
and 596 in the same edit, or the suite fails loudly — which is the desired
behaviour. Line 828's comment change is inert.

Confidence: HIGH

---

ID: C3-04
Severity: P3
Category: DOCUMENTATION ISSUE

File: SECURITY.md
Line: 53-60
Function: (prose — "Scope")

Problem:
`SECURITY.md` enumerates the hosts the app contacts, in a sentence whose grammar
claims completeness:

> Karasu contacts AniList, GitHub (update checks on every platform, downloads
> on desktop only …) and a localhost callback during login. … A Jellyfin
> server you configure yourself is contacted too; that is your machine, not
> ours …

The list omits an entire class of outbound request. `fetch_bio_image`
(`src-tauri/src/commands/images.rs:95-140`) issues a request to an **arbitrary
third-party host named in someone else's AniList bio**, and it fires
automatically on render with no setting and no prompt:

- `src/components/RichText.tsx:102-110` — a `useEffect` calls
  `fetchBioImage(href)` on mount of every `InlineImage`, guarded only by
  `if (!isTauri) return setFailed(true);`.
- `src/api/anilist.ts:285-286` — `invoke<string>("fetch_bio_image", { url })`.
- `src-tauri/src/commands/images.rs:118` — `client.get(parsed).send().await`.

`CLAUDE.md` records where those hosts actually are: across 89 real bios holding
350 images, imgur accounted for 147, tumblr 57, then pinimg, postimg, catbox and
discord — and only 2% were on `*.anilist.co`. So opening a stranger's profile
reveals the user's IP address to several unrelated commercial hosts.

The **design** is documented, deliberate and not the finding. Proxying through
Rust was chosen over widening `img-src` after measurement, and the
implementation is sound: SSRF refusal on the URL and on every redirect hop with
a 3-hop ceiling (`images.rs:96-113`), a content-type allowlist, a size cap
checked both from `Content-Length` and again after read, a timeout, no cookies
and no `Referer`. `RichText.tsx:80-82` states the residue plainly — "The host
still learns the user's IP." The finding is that the security policy the user
actually reads does not say so, while listing everything else the app talks to.

The same sentence also omits `raw.githubusercontent.com`
(`src-tauri/src/playback/relations.rs:13`), refetched every seven days and
written to the user's disk. That is arguably folded into "GitHub", but if a
paragraph is being added it should name this too.

Expected Behavior:
A `SECURITY.md` that enumerates outbound contacts enumerates all of them,
especially the one class of destination the user neither configured nor chose.

Actual Behavior:
The enumeration stops at AniList, GitHub, localhost and the user's own Jellyfin.
The bio-image hosts — the only *unbounded* set — are absent from `SECURITY.md`
and from `README.md`.

Reproduction:
```
sed -n '53,61p' SECURITY.md
grep -ni "image\|bio\|third.part\|proxy" SECURITY.md   # only 47, 131, 133 — nothing about images
sed -n '100,112p' src/components/RichText.tsx          # unconditional useEffect fetch
```

Impact:
A privacy-conscious user reading `SECURITY.md` concludes their machine contacts
four named parties. In practice, browsing the social surface makes it contact
whichever image hosts strangers put in their bios. Nothing beyond the request
itself leaks — no cookies, no `Referer`, no token — so the exposure is the IP
address, the timing, and the fact that a profile containing that image was
opened. That is small, and it is exactly the sort of thing a security policy
exists to state rather than leave a user to discover.

Root Cause:
`fetch_bio_image` was added after the Scope section was written, and the section
was not revisited — the design note went into the code header and `CLAUDE.md`
instead.

Recommended Fix:
Add one paragraph to `SECURITY.md`'s Scope: bio and activity images are fetched
by Rust rather than by the WebView, one bounded request each, no cookies and no
`Referer`, size- and type-capped, local and private addresses refused on the URL
and every redirect hop — and the host learns your IP, which is unavoidable in
any design that shows the image at all. Name `raw.githubusercontent.com` and the
`anime-relations` refresh in the same edit. A "don't load bio images" toggle, if
ever wanted, belongs in the content-filter pane; that is a feature, and this
finding does not ask for it.

Regression Tests Required:
None (documentation). `src/components/RichText.image.dom.test.tsx` already pins
the fetch and fallback behaviour being described.

Confidence: HIGH

---

ID: C3-01
Severity: P4
Category: DOCUMENTATION ISSUE

File: README.md
Line: 89
Function: (prose — "Features → Tracking & scrobbling")

Problem:
The README advertises, by name, six manga sites of which only one is a licensed
publisher:

```
- Manga reading detection (MangaDex, MANGA Plus, Comick, Bato, MangaFire, Asura Scans)
```

`MANGA Plus by SHUEISHA` is the publisher's own official service. The other five
— MangaDex, Comick, Bato.To, MangaFire, Asura Scans — are unlicensed scanlation
hosts or aggregators.

The **code is defensible and should not change on this finding's account**.
`match_manga` (`src-tauri/src/playback/detection/profiles.rs:155-179`) only
strips a suffix from a window title the user's own browser is already
displaying. It performs no network request, stores no URL and offers no link;
`STREAMING_MARKERS` and `MANGA_MARKERS` are string constants consumed by
`str::contains` and `str::strip_suffix` and nothing else. That is passive
recognition, the same technique Taiga uses, and it is **REQUIRED-TECHNICAL** —
the marker string is the site's own title format, and detection cannot work
without it. Nothing in the shipped UI names these sites either: a grep of
`src/i18n/en.ts`, `src/i18n/de.ts` and `src/pages/settings/*.tsx` for
`crunchyroll|mangadex|comick|bato|mangafire|asura|netflix` returns **zero** hits.

The finding is the README line as an editorial matter, and nothing more.

Expected Behavior:
Marketing copy for a project whose charter closes the classic Taiga feed feature
on anti-piracy grounds describes the capability rather than reading a roll-call
of aggregators.

Actual Behavior:
`README.md:89` names five of them in a features list on the project's front page.

Reproduction:
```
sed -n '87,91p' README.md
git grep -nIi -E "mangadex|comick|bato|mangafire|asura" -- src/i18n src/pages   # → no hits
```

Impact:
Editorial. The marginal disclosure is close to zero: the same six names are
already tracked in `profiles.rs:71-79`, which this finding correctly declines to
flag, and GitHub code search indexes `.rs` exactly as it indexes `.md`. The
finding therefore rests entirely on the reading that a bullet list is an
endorsement where a `const` is not — a wording preference, not a defect.

Verification: downgraded from P3 — the same names are already public in the
tracked Rust constants, the charter forbids pointing at *torrents or release
feeds* rather than naming sites whose window titles are parsed, and the original
claims of Trust & Safety reports and store rejections cited no policy or
precedent.

Root Cause:
The README documents the marker table exhaustively instead of describing the
capability. The table itself grew by "which sites do people actually read on",
with no filter for licensing status.

Recommended Fix:
Reword the bullet to describe the capability without the roll-call — e.g. "Manga
reading detection in the browser, including MANGA Plus" — matching the style the
line above it already uses ("Crunchyroll and more"). Keep the detection
constants as they are. If the maintainer wants the stronger position, dropping
the four purely-aggregator markers from `MANGA_MARKERS` costs four constant
entries and breaks no test; `manga_mangadex_chapter` is the only manga-marker
test and uses MangaDex.

Regression Tests Required:
None for the README. If markers are removed, the existing manga tests pass
unchanged — which is itself the coverage gap recorded as C3-08.

Confidence: HIGH

---

ID: C3-02
Severity: P4
Category: DOCUMENTATION ISSUE

File: README.md
Line: 407, 408, 409
Function: (prose — "Star History" section)

Problem:
Three `api.star-history.com` image URLs in the README each carry a
200-character opaque parameter named `sealed_token`, the same value in all
three. It is the only credential-shaped string in the tracked tree — everything
else that matches a secret pattern is an obviously synthetic fixture
(`src-tauri/src/logging.rs:715` `"eyJhbGciOiJSUzI1NiJ9abcdefghijklmnop"`,
`:717-718` `"0123456789abcdef…"`/`"deadbeef…"`,
`src-tauri/src/playback/detection/jellyfin.rs:975-976` all-`f` UUIDs) or a
documented public identifier (`BUILTIN_ANILIST_CLIENT_ID = "46231"` at
`src-tauri/src/commands/auth.rs:13`, `BUILTIN_DISCORD_APP_ID` at
`src-tauri/src/discord.rs:23`, both commented "public, not a secret").

**It is not a leaked secret.** Verified directly against the vendor:
`https://raw.githubusercontent.com/star-history/star-history/master/README.md`
embeds the same `sealed_token` parameter, for star-history's own repository, in
star-history's own public README (value beginning
`DYeTWCAopiiE2umbQNPumg8YbPnyodS4lGzIhhCv…`). A value whose designed purpose is
to be pasted into a public README, and which the vendor publishes for itself, is
not a transmissible credential. "Sealed" means encrypted to star-history's key.

What survives is tidiness: an opaque parameter the chart plausibly does not need,
since `Kyusetzu/Karasu` is public and star-history renders public-repository
charts from unauthenticated URLs. That "plausibly" is not measured — both
`api.star-history.com` and `www.star-history.com` are refused by the agent proxy
here, and the star-history API server is closed source, so removal being safe is
reasoned rather than tested.

Expected Behavior:
A public README carries no opaque token-shaped parameter the page does not need
to render.

Actual Behavior:
The same 200-character value appears three times, and has since the root commit.

Reproduction:
```
grep -c "sealed_token" README.md
git log --all --oneline -S"sealed_token"      # → c0a95d0 only
curl -s https://raw.githubusercontent.com/star-history/star-history/master/README.md | grep -o 'sealed_token=[A-Za-z0-9_-]\{20,40\}'
```

Impact:
Cosmetic. Removing the parameter is a `sed`; confirming the chart still renders
is a page load.

Verification: downgraded from P3/MEDIUM to P4/LOW and recategorised from SECURITY
RISK — the vendor publishes the same parameter in its own public README, so the
"treat the value as burned, revoke or rotate the GitHub authorisation"
recommendation is alarm on an undetermined mechanism and is withdrawn.

Root Cause:
The star-history embed snippet is generated by star-history's web UI while the
user is signed in there, and includes the parameter whether the chart needs one
or not. It was pasted verbatim.

Recommended Fix:
Delete `&sealed_token=…` from all three URLs and reload the README to confirm the
chart still renders. If it does not, restore it — the parameter is not a secret
and nothing depends on its removal.

Regression Tests Required:
None (documentation).

Confidence: LOW on whether the chart renders without the parameter; HIGH on the
facts of what the parameter is and where it appears.

---

ID: C3-05
Severity: P4
Category: DOCUMENTATION ISSUE

File: LICENSE
Line: 1-3 (and `assets/screenshots/`, 7 of 10 files)
Function: n/a

Problem:
Seven of the ten tracked README screenshots contain third-party cover artwork,
rendered at readable size and in quantity:

| File | Third-party artwork |
| --- | --- |
| `anime-list.jpg` | ~60 anime covers, grid view |
| `anime-list-columns.jpg` | ~40 cover thumbnails, list view |
| `manga-list.jpg` | ~50 manga/manhwa covers |
| `manga-list-columns.jpg` | cover thumbnails |
| `overview.jpg` | ~30 covers across three sections |
| `season-overview.jpg` | seasonal covers |
| `local-library.jpg` | ~20 cover thumbnails |

`welcome.jpg`, `statistics.jpg` and `year-in-review.jpg` are clean — the Wrapped
poster in particular is pure typography, bars and the Karasu mark, which is
worth saying because it is the one image the app invites users to share.

These files ship under the repository's blanket grant: `LICENSE` is MIT,
covering "this software and associated documentation files", and README
screenshots are documentation files. There is no carve-out anywhere in
`LICENSE`, `README.md` or `THIRD-PARTY-NOTICES.md`
(`grep -ni "screenshot\|artwork\|cover"` over both licence files returns only an
unrelated line 5 of the notices preamble).

To be explicit about what this is *not*: it is not a claim of infringement.
Screenshots of software in ordinary use are how every comparable project
documents itself, the covers are incidental to depicting the UI, they are
thumbnails, and the running app serves them from AniList's own CDN.

A second, smaller note on the same files: `local-library.jpg` shows the
maintainer's real library root (`Z:\Jellyfin`) and about twenty of their own
media filenames, and every screenshot shows the account name `Kyusetzu` and the
full library. That is the maintainer's own data and their own call — recorded
here so the decision is a decision.

Expected Behavior:
Either the screenshots are excluded from the MIT grant by an explicit note, or
the grant accurately describes what it covers.

Actual Behavior:
`LICENSE` sublicenses "associated documentation files" without qualification;
seven of them consist substantially of other people's artwork.

Reproduction:
```
ls assets/screenshots/
# open assets/screenshots/manga-list.jpg — cover grid
sed -n '1,3p' LICENSE
grep -ni "screenshot\|artwork\|cover" LICENSE THIRD-PARTY-NOTICES.md
```

Impact:
Negligible in practice. A licence cannot convey rights the licensor does not
hold, so the MIT text does not become a false statement with legal effect — it
simply has no operation over content the project never owned, which is the
position of every software project that ships a screenshot and none of which
carve this out. What remains is a theoretical mis-description, cheap and
harmless to correct.

Verification: downgraded from P3 — the underlying use is standard and
non-infringing (the original pass concedes this), and a grant that overreaches
what the grantor owns is inoperative rather than injurious.

Root Cause:
`LICENSE` was written for the code and `THIRD-PARTY-NOTICES.md` for the shipped
binary's dependencies. Neither considered tracked images.

Recommended Fix:
Add three lines to `THIRD-PARTY-NOTICES.md`, or a short note under README's
Screenshots heading: the screenshots depict the application in use; cover artwork
visible in them belongs to its respective rights holders and is not licensed
under this project's MIT grant; the MIT grant covers the software and the
project's own artwork (`assets/logo.png`, `src-tauri/icons/`,
`src/assets/karasu-mark.svg`).

Regression Tests Required:
None.

Confidence: HIGH

---

ID: C3-06
Severity: P4
Category: DOCUMENTATION ISSUE

File: THIRD-PARTY-NOTICES.md
Line: 1-102 (absence)
Function: n/a

Problem:
`anime-relations` is the only third-party **dataset** the app fetches, caches to
disk and depends on at runtime, and it appears nowhere in
`THIRD-PARTY-NOTICES.md`. The notices file covers fonts, SQLite, 605 Rust crates
and the npm tree; the dataset is absent.

Evidence of the dependency:

- `src-tauri/src/playback/relations.rs:12-13` — `SOURCE_URL =
  "https://raw.githubusercontent.com/erengy/anime-relations/master/anime-relations.txt"`.
- `relations.rs:135` — cached as `anime-relations.txt` in the app data dir.
- `relations.rs:147-190` — refetched whenever the cache is older than
  `MAX_AGE_SECS` (7 days), and rewritten to disk.
- Consumed by `scrobbler.rs:493`, `library.rs:88`/`:270`/`:1553` and
  `src/lib/seasonSplit.ts:5`.

Attribution is not absent from the project — `README.md:103` links
[anime-relations](https://github.com/erengy/anime-relations) inline in the
feature bullet, and `relations.rs:1-2` credits it in the module header.

**The blocking unknown is resolved.** `curl
https://raw.githubusercontent.com/erengy/anime-relations/master/LICENSE` returns
**CC0 1.0 Universal** — a public-domain dedication that waives copyright and
expressly imposes no attribution requirement. There is therefore no licence
obligation to discharge, and Karasu redistributes nothing: each user's own
machine fetches the file from upstream.

What is left is a one-row courtesy entry, plus the procedural point underneath
it, which is the part worth acting on. The notices file is reproducible from
`npm ls` and `cargo metadata` (lines 12-20 say so); a dataset fetched by a
hardcoded URL appears in neither dependency graph, so the generation procedure
structurally cannot see it. The file therefore looks complete when it is not,
and re-running the two commands will never reveal that.

Expected Behavior:
Every third-party work the project causes to be placed on a user's machine is
named in `THIRD-PARTY-NOTICES.md` with its licence, or is explicitly out of scope
with a stated reason.

Actual Behavior:
The dataset is named in the README as a feature and in a Rust module header as a
credit, and nowhere as a licensed work.

Reproduction:
```
grep -ni "anime-relations\|erengy" THIRD-PARTY-NOTICES.md      # → no hits
sed -n '1,16p' src-tauri/src/playback/relations.rs
curl -s https://raw.githubusercontent.com/erengy/anime-relations/master/LICENSE | head -1   # CC0 1.0 Universal
```

Impact:
Minimal, and now bounded: one table row. The reason to do it is that "we fetch a
community dataset every seven days and cache it on the user's disk" is exactly
what an auditor or a distro packager asks about, and the notices file having no
answer is a worse look than the answer.

Verification: confidence raised from MEDIUM to HIGH — the upstream licence was
fetched and is CC0-1.0, which removes the finding's larger branch (a possible
unmet obligation) and leaves the courtesy entry and the procedural gap.

Root Cause:
The notices file's generation procedure reads two dependency graphs. A
runtime-fetched dataset is in neither.

Recommended Fix:
Add a short section to `THIRD-PARTY-NOTICES.md` naming the dataset, the source
URL, **CC0-1.0**, and the fact that it is downloaded at runtime rather than
bundled. Add a line to the file's preamble noting that runtime-fetched data is
out of reach of the two reproduction commands, so the next person does not
assume the file is complete because the commands were re-run.

Regression Tests Required:
None. `relations.rs`'s parser tests (`parses_basic_rule` and siblings) already
pin the data format.

Confidence: HIGH

---

ID: C3-07
Severity: P4
Category: IMPROVEMENT

File: src-tauri/tauri.conf.json
Line: 52
Function: `bundle.resources`

Problem:
`THIRD-PARTY-NOTICES.md` ships with every build —
`"../THIRD-PARTY-NOTICES.md": "THIRD-PARTY-NOTICES.md"` in `bundle.resources` —
plus a byte-identical copy at
`src-tauri/gen/android/app/src/main/assets/THIRD-PARTY-NOTICES.md` (both
`md5 a7ee7daa13d93bb4a07f8c8f4c29d18b`, so the drift `CLAUDE.md` warns about has
not happened). But nothing in the app points at it: `grep -ni
"notice\|licen\|third" src/pages/About.tsx` hits only an unrelated updater
comment at line 272, and `src/i18n/en.ts` has no notices key at all.

This satisfies the letter of both font licences — OFL-1.1 §2 and Apache-2.0
§4(a) require the licence to *accompany* the redistributed font, and a file
installed beside the binary and packed into the APK accompanies it. So this is
an improvement, not a compliance gap.

Expected Behavior:
A user who wants to know what is inside the app can find the notices from the
About page.

Actual Behavior:
The file is on disk next to the executable, and inside the APK where a user has
no ordinary way to reach it at all, with no in-app path to it.

Reproduction:
```
sed -n '51,53p' src-tauri/tauri.conf.json
grep -ni "notice\|licen\|third" src/pages/About.tsx src/i18n/en.ts
md5sum THIRD-PARTY-NOTICES.md src-tauri/gen/android/app/src/main/assets/THIRD-PARTY-NOTICES.md
```

Impact:
Cosmetic. It matters slightly more on Android, where "shipped in `assets/`" means
"present but unreachable without unzipping the APK".

Root Cause:
The resource was added for compliance; the UI affordance was never the point.

Recommended Fix:
One line on the About page opening the bundled file through the existing opener
plugin — or, on Android, linking to the GitHub copy — with the usual `en`/`de`
key pair, which `de: typeof en` will enforce.

Regression Tests Required:
`src/lib/i18nKeys.test.ts` resolves every literal `t("…")` and will catch a
missing key on its own.

Confidence: HIGH

---

ID: C3-08
Severity: P4
Category: MISSING TEST

File: src-tauri/src/playback/detection/profiles.rs
Line: 63-79
Function: `STREAMING_MARKERS`, `MANGA_MARKERS`

Problem:
Ten site markers are defined; two are exercised. The test module (lines 181-256)
has positive assertions for mpv, Crunchyroll in two title spellings and
MangaDex, plus three negative cases. `ADN`, `Netflix`, `MANGA Plus`, `Comick`,
`Bato.To`, `Bato.to`, `MangaFire` and `Asura Scans` have no test at all.

The suffixes for those eight are assertions about another site's `<title>`
format, which is exactly the kind of string that rots silently: a site changes
its separator from `-` to `|`, `strip_suffix` stops matching, `match_streaming`
returns the untrimmed string, and the parser then either fails to find an episode
number — detection silently stops for that site — or matches the wrong title.
Nothing fails, and nothing says so.

This is recorded here rather than in the detection dimension because it
conditions C3-01's recommendation: if the maintainer prunes the aggregator
markers, no test breaks, which is both convenient and the reason the gap is
worth naming.

Expected Behavior:
Each marker has at least one positive test pinning the exact title shape it was
written against.

Actual Behavior:
Eight of ten have none.

Reproduction:
```
sed -n '63,79p' src-tauri/src/playback/detection/profiles.rs
sed -n '181,256p' src-tauri/src/playback/detection/profiles.rs
```

Impact:
Detection for a site can break with a green suite and no user-visible error — it
presents as "Karasu just stopped noticing" rather than as a bug with a cause.

Root Cause:
Markers were added incrementally; the tests were written once, for the two
representative cases.

Recommended Fix:
One `assert_eq!` per surviving marker, each using the literal title shape the
suffix was derived from — the same form the two Crunchyroll tests already take.
Cheap, and it documents the observed title format, which is the part that is
otherwise unrecorded (the doc comment at `profiles.rs:60-62` does this for
Crunchyroll only).

Regression Tests Required:
This finding *is* the test request.

Confidence: HIGH

---

ID: C3-10
Severity: P4
Category: PROCESS

File: audit/ (this report series)
Line: n/a
Function: n/a

Problem:
Two findings' confidences were set by a capability limit that was assumed rather
than tested. Both C3-02 and C3-06 named their blocking unknown precisely and
correctly, and both attributed the inability to resolve it to "this audit has no
network access". The environment provides outbound HTTPS through a configured
proxy, documented in `/root/.ccr/README.md` and exposed as `$HTTPS_PROXY`.

One `curl` settled C3-06 — `erengy/anime-relations` is CC0-1.0, which removed
the finding's entire licence-obligation branch. One `curl` settled the framing
of C3-02 — star-history publishes the same `sealed_token` parameter in its own
public README, which removed a SECURITY RISK categorisation and a
rotate-your-credentials recommendation.

Expected Behavior:
A stated inability that sets a finding's confidence is tested before it is
stated.

Actual Behavior:
It set two MEDIUM confidences, one of which carried an unwarranted security
categorisation into a report.

Reproduction:
```
curl -sS "$HTTPS_PROXY/__agentproxy/status"
curl -s https://raw.githubusercontent.com/erengy/anime-relations/master/LICENSE | head -1
```

Impact:
Process only; no effect on the product. Both affected findings are corrected in
this report. Recorded so the next pass over this repository checks the proxy
before declaring a question unanswerable — the same proxy also denies
`api.star-history.com`, so the boundary is real but narrower than assumed, and
knowing where it actually falls is worth one command.

Root Cause:
The capability was inferred from the read-only framing of the task rather than
probed.

Recommended Fix:
Probe `$HTTPS_PROXY/__agentproxy/status` at the start of any audit pass whose
findings turn on an upstream fact, and record which hosts are actually refused
rather than asserting a blanket limit.

Regression Tests Required:
None.

Confidence: HIGH — Source: found during adversarial verification

---

## Inventories

### STREAMING-SITE INVENTORY

All markers are string constants in
`src-tauri/src/playback/detection/profiles.rs`, matched against a window title by
`str::contains` / `str::strip_suffix`. No entry is fetched, linked or shown in
the UI. "Required?" means "required to detect that site", not "required to ship";
every marker string that is kept is **REQUIRED-TECHNICAL**, because it *is* the
site's own title format and detection cannot work without it.

**Video — `STREAMING_MARKERS` (profiles.rs:63-67)**

| Site | Where | Legal service? | Required? |
| --- | --- | --- | --- |
| Crunchyroll | `profiles.rs:64` | Yes — licensed (Sony) | Yes. REQUIRED-TECHNICAL. Two title formats covered and both tested |
| ADN (Animation Digital Network) | `profiles.rs:65` | Yes — licensed (FR/DE) | Yes. REQUIRED-TECHNICAL. The main licensed service for the FR/DE audience the app also translates for. Untested (C3-08) |
| Netflix | `profiles.rs:66` | Yes — licensed | Yes. REQUIRED-TECHNICAL. Untested (C3-08) |

Every video marker is a licensed service. Nothing to flag.

**Manga — `MANGA_MARKERS` (profiles.rs:71-79)**

| Site | Where | Legal service? | Required? |
| --- | --- | --- | --- |
| MangaDex | `profiles.rs:72` | No — unlicensed scanlation host (community, takedown-responsive) | Widely used; the only manga marker with a test. REQUIRED-TECHNICAL while kept |
| MANGA Plus by SHUEISHA | `profiles.rs:73` | **Yes** — Shueisha's own service | Yes. REQUIRED-TECHNICAL. Untested (C3-08) |
| Comick | `profiles.rs:74` | No — unlicensed aggregator | No. No test, no licensed content. First candidate if the markers are pruned |
| Bato.To / Bato.to | `profiles.rs:75-76` | No — unlicensed aggregator (two casings) | No |
| MangaFire | `profiles.rs:77` | No — unlicensed aggregator | No |
| Asura Scans | `profiles.rs:78` | No — scanlation group's own site | No |

**Browsers — `BROWSERS` (profiles.rs:26-38)** — chrome, firefox, msedge, brave,
opera, opera_gx, vivaldi, zen, librewolf, waterfox, helium. Process names only.
Nothing to flag.

**Players — `PLAYERS` (profiles.rs:6-18)** — mpv/mpv.net, VLC, MPC-HC/BE,
PotPlayer, SMPlayer. All open-source or freeware players. Nothing to flag.

**Other detection sources** — Jellyfin (`playback/detection/jellyfin.rs`, the
user's own server), MPRIS/SMTC (`media_session/`), mpv IPC (`mpv_ipc.rs`, local
socket). No piracy adjacency.

**Piracy-term sweep.**
`git grep -nIi -E "torrent|magnet:|nyaa|rss|piracy|fansub|ddl|xdcc|scene release"`
over the tracked tree, excluding lockfiles and `audit/`, returns: the project's
own rejection statements (`CLAUDE.md:191`, `:194`, `CONTRIBUTING.md:25`,
`ROADMAP.md:17`); "fansub" twice as a *format* name in
`src-tauri/src/playback/recognition/parser.rs:47` and `:233`; and
`dot_separated_scene_release` at `parser.rs:248` naming a filename convention.
No feed reader, no magnet handling, no tracker of any kind. **Clean.**

### TITLE-FIXTURE INVENTORY

221 lines across 33 files mention a real anime or manga title. Titles are not
copyrightable subject matter, so none of this is a legal exposure; the
classification is about whether the fixture earns its specificity.

| Cluster | Class | Note |
| --- | --- | --- |
| Release-name parsing — `parser.rs:230-300`: Sousou no Frieren, Kusuriya no Hitorigoto 2nd Season, One Piece, Oshi no Ko S2, Mob Psycho 100, Suzume no Tojimari, Frieren: Beyond Journey's End | **REQUIRED** | Each pins a shape a synthetic name cannot. `Mob Psycho 100` is a number that is part of the title; `One Piece 1071` a four-digit episode; `Oshi no Ko S2` an inline season marker; `Frieren: Beyond Journey's End Season 1 Ep 28` a colon plus apostrophe plus season plus streaming keyword; `Suzume no Tojimari (2022)` a year that is not an episode |
| Romaji/English cross-match — `matcher.rs:210-340`: Sousou no Frieren ↔ Frieren: Beyond Journey's End; Kusuriya no Hitorigoto 2nd Season; One Piece Season 3 | **REQUIRED** | The whole point is that AniList carries several unrelated-looking titles for one entry. Synthetic pairs cannot encode a real romaji/English divergence |
| Season ambiguity — `scrobbler.rs:1348-1360`, `db.rs:1569`, `CLAUDE.md`: Beyblade Metal Fusion / Metal Masters / Metal Fury | **REQUIRED** | Three separate 51-episode AniList entries under one franchise is the exact case `season_informed` exists for. The comment says so and could not say it without the example |
| Fuzzy-match negatives — `src/lib/fuzzy.test.ts:41-99`: Frieren, Bleach, Attack on Titan, Steins;Gate | **REQUIRED** | The straddle test needs two titles sharing no trigrams (`Attack on Titan` + `Bleach` against the query `titan bleach`); `Steins;Gate` pins punctuation handling |
| Import/export parsing — `malImport.test.ts:51-109`, `jsonImport.test.ts`: Berserk, `Steins;Gate &amp; friends &lt;3`, Chainsaw Man, Frieren | **REQUIRED** for the entity row, **GRATUITOUS** for the rest | `Steins;Gate & friends <3` tests XML entity decoding and needs a title carrying `&` and `<`. Berserk and Chainsaw Man are placeholders |
| Fansub group names — `parser.rs:234`, `:242`, `matcher.rs`, `library.rs` (×8), `logging.rs:598`, `mpv_ipc.rs`, `media_session/mod.rs`, `.github/ISSUE_TEMPLATE/bug_report.yml:87`: `[SubsPlease]`, `[Erai-raws]` | **GRATUITOUS** | `[Group]` already appears as a synthetic bracket tag at `parser.rs:305` and `media_session/mod.rs:653` and tests the same extraction. Two real group names buy nothing the synthetic one does not. Low priority — a release group name is not a claim about anything, and no group is credited, linked or endorsed |
| Generic fixtures — `db.rs` (×34), `jellyfin.rs`, `i18n.rs:212`, `siteNotifications.test.ts`, `ical.test.ts`, `SeasonHero.dom.test.tsx`, `MediaCard.dom.test.tsx`: Frieren, Bleach, One Piece as arbitrary strings | **GRATUITOUS** | Pure placeholders — `"foo"` would pass identically. No reason to change them either |
| Prose illustration — `README.md`, `CLAUDE.md`, `columns.ts:65`, `shared.ts:7`, `queries.ts:683`: One Piece as the long-runner that broke a fixed column width and costs +49 KB | **DEFENSIBLE** | The example is the measurement |

No character name appears anywhere; `CHANGELOG.md` and `ROADMAP.md` contain no
titles at all.

### URL INVENTORY (unexpected entries only)

The expected destinations are omitted here: `graphql.anilist.co`
(`anilist/client.rs:9`), `anilist.co` OAuth authorize (`anilist/auth.rs:412`),
the GitHub releases endpoints (`commands/update.rs:93-102`, desktop only), the
user's own Jellyfin, and the loopback callback `localhost:46231`
(`anilist/login.rs:24`, bound to `127.0.0.1` at `:137`). All four are documented
and expected.

| Entry | Where | Note |
| --- | --- | --- |
| **arbitrary third-party image hosts** | `commands/images.rs:118` via `RichText.tsx:105` | The only unbounded destination set, fired automatically on render. Design deliberate and sound; **not disclosed in SECURITY.md — C3-04** |
| `raw.githubusercontent.com/erengy/anime-relations/…` | `playback/relations.rs:13` | Dataset, refetched every 7 days and written to the user's disk. Licence CC0-1.0; absent from the notices file — C3-06. Also absent from SECURITY.md's enumeration — C3-04 |
| `api.star-history.com` | `README.md:407-409` | Documentation only. Carries the `sealed_token` parameter — C3-02 |
| `discord.gg/yeHNSGyM8F` | `README.md`, `About.tsx:43` | The maintainer's own server. Intentional |
| `virustotal.com` | `.github/workflows/release.yml`, disclosed at `README.md:266` | Release scan. Intentional and documented |
| Test-fixture hosts | `anilistMarkdown.test.ts`, `RichText.image.dom.test.tsx`, `images.rs` tests | `i.imgur.com`, `64.media.tumblr.com`, `i.pinimg.com`, `files.catbox.moe`, `s4.anilist.co`, `open.spotify.com`, `steamcommunity.com`, `a.favicon.im`, `static2.klipy.com`, `gifcity.carrd.co`, `instagram.com`, `youtu.be`, `a.co`, `x.co`, `example.com`, `93.184.216.34`. Never fetched by the app; two of them carry the real-bio provenance in C3-03 |
| Deliberate attack strings | `images.rs` SSRF suite, `anilistUrl.test.ts` host-confusion suite | `evil.example`, `anilist.co.evil.com`, `notanilist.co`, `http://www.anilist.co`, `169.254.169.254`, `127.1.2.3`, `10.0.0.5`, `172.16.4.4`, `192.168.1.1`, `0.0.0.0`, `router.local`, `nas:8096`. Their presence is a good sign, not a finding |

Documentation and CI only, all unremarkable: `img.shields.io` (6 badges),
`github.com`, `nodejs.org`, `rustup.rs`, `vite.dev`, `keepachangelog.com`,
`contributor-covenant.org`, `developer.android.com`, `EditorConfig.org`.
Namespaces and schemas, never fetched: `schemas.android.com` (18), `w3.org` (4),
`gradle.org` (2), `schema.tauri.app`, `apache.org`.

**Plain HTTP outside the documented Jellyfin case:** none, other than the
loopback OAuth callback (`login.rs:35-37` explains why loopback counts as a
potentially-trustworthy origin) and the namespace URIs, which are identifiers
rather than endpoints.

**Telemetry: none.** The `sentry|posthog|mixpanel|matomo|plausible|umami|
google-analytics|gtag|amplitude|telemetry|analytics|bugsnag|crashlytics` sweep
returns only the unrelated English words "plausible" and "amplitudes". Traced to
the two candidate paths rather than asserted: `log_frontend_error`
(`commands/system.rs:381-386`) formats and calls `crate::logging::error("ui", …)`
and returns — no client, no network; `export_diagnostics` (`:404-462`) composes a
Markdown string, opens `blocking_save_file()` and `std::fs::write`s to the
user-picked path; `src-tauri/src/diagnostics.rs` contains no `reqwest`, no
`Client`, no `send()` and no `http`. The claim holds.

### HISTORY SCAN RESULTS

52 commits, single lineage, root `c0a95d0`; `main` and the audit branch only,
both present on `origin`. All checks read-only, and re-run independently during
verification.

- `git log --all --diff-filter=D --name-only` — **no file has ever been deleted
  in this history.** There is therefore no deleted `.env`, key, keystore or
  credential file to recover.
- `git log --all -S` for `client_secret`, `BEGIN PRIVATE KEY`, `BEGIN RSA`,
  `ghp_`, `github_pat_`, `AKIA`, `xoxb-`, `password=`, `-----BEGIN`, `AIza`,
  `gho_`, `ghs_`, `SECRET_KEY`, `PRIVATE KEY` — **zero hits, all fourteen.**
- `sk-` and `api_key` hit only `.github/workflows/release.yml:323`
  (`${{ secrets.VT_API_KEY }}`) and `jellyfin::delete_legacy_api_key`.
- `storePassword`, `keyAlias`, `key.properties`, `eyJ`, `sealed_token` — hits in
  `c0a95d0` only. Each traced: `app/build.gradle.kts:39-42` reads a **gitignored**
  `key.properties` (`gen/android/.gitignore:16-17` excludes both it and
  `keystore.properties`), with a debug-signing fallback so CI without secrets
  still builds; `eyJ` is the synthetic JWT in `logging.rs:715`; `sealed_token` is
  C3-02.
- No `.jks`, `.keystore`, `.p12`, `.pem`, `.key`, `.env`, `key.properties` or
  `keystore.properties` file is tracked.
- Long-string sweep `git grep -oE '"[A-Za-z0-9_/+=-]{32,}"'` over `src`,
  `src-tauri/src`, `scripts` and `.github` — every hit is a file path, a JSON
  pointer, an AniList notification type name, or an obviously synthetic fixture
  (`0123456789abcdef…`, `deadbeef…`, all-`f` UUIDs, `a1b2c3d4-e5f6-…`).
- Both built-in IDs are public by design and commented as such:
  `BUILTIN_ANILIST_CLIENT_ID = "46231"` (`commands/auth.rs:13`, "the ID is
  public, not a secret") and `BUILTIN_DISCORD_APP_ID = "1527934275356332133"`
  (`discord.rs:23`, "public, not a secret"). The charter forbids a client
  *secret*; none exists in the tree or in history.
- **The maintainer's contact details are published deliberately, not leaked** —
  `contact@kyusetzu.de` in `SECURITY.md:149`, `README.md:398` and
  `CODE_OF_CONDUCT.md:36`; the AniList handle and user id 153164 in
  `scripts/anilist-query.mjs:6-25` and `CLAUDE.md`; account name and id 6421433
  as test fixtures in `alerts/airing.rs:347` and `db.rs:2398`. All the
  maintainer's own, all intentional.
- **No machine-path leakage.** Every `C:\Users\…` and `/home/…` in tracked source
  is a deliberate test fixture using the maintainer's own handle
  (`diagnostics.rs:284`, `:288`, `:302`, `logging.rs:598-599`,
  `portable.rs:169-193`, `commands/playback.rs:530`).

**No secret is present in the history.** The only content-hygiene issue the scan
surfaces is what the history now *contains* rather than what it hides: the eight
tracked audit reports of C3-09.

---

## Verified sound

- **No piracy tooling of any kind.** The `torrent|magnet|nyaa|rss|xdcc|ddl`
  sweep returns only the project's own rejection statements and two uses of
  "fansub"/"scene release" as filename-format names in `recognition/parser.rs`.
  There is no feed reader, no magnet handler and no tracker anywhere in the tree.
- **All three video streaming markers are licensed services.** Crunchyroll, ADN
  and Netflix in `STREAMING_MARKERS` (`profiles.rs:63-67`).
- **Site markers are inert data.** `match_streaming` and `match_manga`
  (`profiles.rs:126-179`) reach the constants only through `str::contains` and
  `str::strip_suffix`, and both return `None` unless
  `recognition::parser::parse` finds an episode or chapter number — so an
  overview page is refused (`streaming_overview_page_ignored`,
  `manga_overview_page_ignored`). No request, no link, no storage.
- **No site name reaches the user interface.** Zero hits for
  `crunchyroll|mangadex|comick|bato|mangafire|asura|netflix` across
  `src/i18n/en.ts`, `src/i18n/de.ts` and `src/pages/settings/*.tsx`.
- **No character imagery or promotional artwork as standalone assets.** Every
  tracked image is either the project's own crow mark (`assets/logo.png`,
  `public/favicon.png`, `src/assets/karasu-mark.svg`, `src-tauri/icons/**`,
  `gen/android/**/mipmap-*`), one of two NSIS installer bitmaps, or a UI
  screenshot.
- **The app icon is original.** `src-tauri/icons/app-icon.svg:2-7` documents its
  provenance — generated from `design/Logo - Karasu Icon no BG.svg`, which
  `.gitignore` keeps out of the tree — and the art is a stylised crow on a
  gradient disc with no third-party element. `assets/logo.png` is the same bird
  with the KARASU / カラス wordmark.
- **Screenshot metadata is clean.** All ten `assets/screenshots/*.jpg` begin
  `ffd8ffe000104a464946` — bare JFIF with **no Exif segment**, so no camera,
  software, timestamp or GPS. Worth checking because these are the maintainer's
  own desktop captures.
- **The Wrapped poster contains no third-party artwork.**
  `assets/screenshots/year-in-review.jpg` is typography, bars and the Karasu
  mark — worth recording because it is the one image the app invites users to
  share publicly.
- **Font licences are satisfied in full.** `THIRD-PARTY-NOTICES.md:24-45` names
  SN Pro (OFL-1.1) and Kosugi Maru (Apache-2.0), their sources and their
  copyright lines, and states neither is modified; the complete SIL OFL-1.1 text
  is reproduced at lines 130-227 and the complete Apache-2.0 text at 228-430,
  which is what OFL §2 and Apache §4(a) require of a bundler. The file ships via
  `tauri.conf.json:51-53`, and the Android copy is byte-identical
  (`md5 a7ee7daa13d93bb4a07f8c8f4c29d18b` on both) — the drift `CLAUDE.md` warns
  about has not occurred.
- **Licence completeness otherwise.** MIT at the root (`LICENSE`, "Copyright (c)
  2026 Kyu and Karasu contributors"); SQLite's public-domain blessing quoted at
  `THIRD-PARTY-NOTICES.md:45-53`; the crate and npm spreads tabulated with the
  five MPL-2.0 crates called out by name and source, and "No GPL, and no
  LGPL-only crate" asserted with `r-efi`'s tri-licence resolved;
  `package.json:8` declares MIT.
- **No copyleft in the installed npm tree.** A recursive scan of `node_modules`
  `package.json` `license` fields for `GPL|AGPL|SSPL|CC-BY-NC|proprietary`
  returns nothing, corroborating `THIRD-PARTY-NOTICES.md:96-98`.
- **Taiga is credited.** `README.md:33` ("inspired by the wonderful [Taiga]"),
  `CLAUDE.md:11-12`, and module-level credits at `playback/detection/mod.rs:2`
  (Anisthesia), `recognition/parser.rs:2` (Anitomy), `library.rs:3` and
  `discord.rs:21`.
- **`anime-relations` is attributed in prose.** `README.md:103` links it and
  `relations.rs:1-2` credits it, naming Taiga as the shared source. Its licence
  is CC0-1.0, which imposes no attribution requirement at all — the project
  exceeds what is asked. (The notices-file gap is C3-06.)
- **Plex and Emby are correctly absent as integrations.** All nine references are
  either charter rejections (`CLAUDE.md:188`, `CONTRIBUTING.md:27`,
  `ROADMAP.md:17`) or accurate descriptions of what the *media-session* pass
  incidentally covers because Plex publishes SMTC/MPRIS like any other player
  (`media_session/mod.rs:7`, `README.md:92`, `en.ts:1361`/`de.ts:1360`). No Plex
  or Emby API client exists. `logging.rs:190-192`'s `x-emby-token` scrub rule is
  correct and necessary: Jellyfin is an Emby fork and still emits that header.
- **Third-party naming is nominative throughout.** MyAnimeList appears only as
  the name of an interchange format (`lib/malExport.ts`, `lib/malImport.ts`,
  `en.ts:871-1248`); Discord, Jellyfin and AniList are named to say what is being
  talked to. No third-party logo, wordmark or brand asset is tracked, and nothing
  suggests affiliation or endorsement.
- **No telemetry, and the two candidate paths are provably local** — traced in
  the URL inventory above. The five runtime destinations are AniList, GitHub,
  `raw.githubusercontent.com` (dataset), the user's own Jellyfin, and bio-image
  hosts.
- **Git history holds no secret.** No file has ever been deleted; zero hits for
  fourteen secret patterns; no keystore, PEM, JKS or `.env` tracked; Android
  release signing reads a gitignored `key.properties` with a debug fallback
  (`app/build.gradle.kts:17-66`).
- **CI hygiene.** Every `uses:` in `.github/workflows/{ci,release}.yml` is pinned
  to a full 40-hex commit SHA with the version in a trailing comment —
  `grep -v '@[0-9a-f]{40}'` over all `uses:` lines returns nothing — and every
  credential is a `${{ secrets.* }}` reference (`TAURI_SIGNING_*`, `VT_API_KEY`,
  the four `ANDROID_*`). No literal secret in any workflow.
- **Tracked editor and agent config is inert.** Only `.claude/launch.json` and
  `.vscode/extensions.json`; both are three-line stubs with no paths, tokens or
  machine detail.
- **The maintainer's published contact details are a deliberate choice** and are
  consistent across `SECURITY.md:149`, `README.md:396-401` and
  `CODE_OF_CONDUCT.md:36`.

---

## Counts

| Severity | Count |
| --- | --- |
| P0 | 0 |
| P1 | 0 |
| P2 | 1 |
| P3 | 2 |
| P4 | 7 |
| **Total** | **10** |

Refuted during verification: 0 — no finding from the original pass was refuted
outright. Three were downgraded (C3-01, C3-02, C3-05), one had its framing
narrowed while keeping its severity (C3-03), and two findings were added from
verification (C3-09, C3-10).

Karasu is legally in good order for a public release. There is no piracy tooling
in the tree, no telemetry, no secret in fifty-two commits of history, no
third-party branding, an original app icon, screenshots with no Exif, and font
licences satisfied down to the reproduced OFL and Apache texts in a notices file
that ships byte-identically on desktop and Android. The single item to settle
before the branch is merged or the repository is published is C3-09: the audit
reports themselves, including this one, are tracked and already on `origin`.
