# Security Policy

## Scope

Karasu is a local app (desktop and Android) with **no hosted backend** — it
talks directly to the AniList GraphQL API from your device. There's no server
of ours to compromise; the realistic attack surface is the app itself and the
secrets it holds:

- your **AniList OAuth token**, and
- your **Jellyfin access token**, if you connected a Jellyfin server.

On desktop both live in your OS credential store (Windows Credential Manager,
or the Secret Service on Linux). On Android they are files in the app-private
data directory, sealed with AES-256-GCM under a key held by the **Android
Keystore** (`TokenCipher.kt`; the file is `KRSA1 || iv || ciphertext`). The
key never leaves the Keystore — it is hardware-backed where the device offers
that and not extractable, so the ciphertext is useless copied off the device.
What the Keystore does *not* give is worth stating just as plainly: an
attacker with code execution inside the app's sandbox can call the same
sealing API the app does. It protects the bytes at rest, not against a
compromised app. A token a pre-Keystore build wrote in plain text migrates
into the sealed format on first read; a file that does not decrypt reads as
signed out rather than as somebody's token. (iOS, which is neither compiled
nor shipped, would still use a plain file.)

Neither token is ever handed to the WebView — the UI only ever learns
*whether* one is stored.

In the default desktop layout the credential store is the only place either
token is persisted. Two layouts keep tokens in files instead, each encrypted at
rest in its own way. **Portable mode** keeps the AniList token in a file beside
the executable so the folder travels — DPAPI on Windows, XChaCha20-Poly1305
under a Secret Service-held key on Linux (the `KRSU1` format). Both bind the
file to that machine and user account, so a portable folder copied elsewhere
does not carry a usable sign-in. **Android** is the Keystore-sealed file
described above, bound to the device the same way. Signing out clears the
file, the credential store entry and the encryption key — whichever of those
exist on the platform.

The Jellyfin token is additionally held in memory by the Rust process while the
app runs, so that the detection poll does not reach for the credential store
every five seconds; it is dropped on exit and cleared on sign-out.

Signing in to Jellyfin sends your username and password to your own server
once, in exchange for that access token (`/Users/AuthenticateByName` — Jellyfin
has no OAuth, so this is how every third-party client authenticates). **The
password is never written to disk and never kept in memory beyond the request.**
An ordinary account is enough; Karasu deliberately does not use an admin API
key, because an API key makes Jellyfin report every session on the server
rather than only your own.

Karasu contacts AniList, GitHub (update checks on every platform, downloads
on desktop only — on Android the check is a notice pointing at the releases
page, and nothing is downloaded or installed) and a localhost callback during
login. On
Android the callback server still runs on localhost; its success page hands
control back to the app through the `karasu://` custom scheme. A Jellyfin
server you configure yourself is contacted too; that is your machine, not
ours, and the "no hosted backend" guarantee is unaffected.

Things worth reporting: the app mishandling or leaking either secret, a way to
execute arbitrary code via a malicious media title/filename/response, or a
flaw in the desktop update mechanism (Karasu verifies every downloaded update
against its own signing key — a way to bypass that would be serious). Android
has no update mechanism to attack: the APK updates by `adb install -r` or a
store, and its trust anchor is the Android signing key — CI signs release APKs
from repository secrets, and Android itself refuses to install over an APK
whose signature does not match.

## The log file

Karasu keeps a log beside its database (`karasu.log`, in the same folder the
portable-mode section above describes). It records errors, panics and lifecycle
events; with **Verbose logging** on it also records what detection saw, which
means titles and file paths.

Credentials never reach it. Both tokens, the Jellyfin password and the sealed
portable key are replaced with a labelled `<CREDENTIAL_…>` placeholder at the
moment a line is written — not when it is read — so the file on disk is safe and
no command can read one back out through it. Anything else secret-shaped that
matches no specific rule is replaced too, so an unforeseen leak fails closed.

It is local and stays local: nothing is uploaded, and there is nowhere to upload
it to. **About → Copy diagnostics** and **Save report** redact your home
directory by default, but with verbose logging on the log itself can name what
you have been watching — worth a glance before attaching it to a public issue.

## The update signing key

Every update Karasu downloads is verified against a minisign public key
compiled into the binary (`plugins.updater.pubkey` in `tauri.conf.json`). That
is what makes the update mechanism worth trusting, and it has a consequence
worth stating plainly rather than discovering later:

**If the private key is lost, every installed copy of Karasu becomes permanently
un-updatable.** Not "until we publish a new one" — an install only trusts the
key it was built with, so a new key can only reach users through a manual
reinstall. There is no recovery path that does not involve every user
downloading an installer by hand.

The private half lives in the `TAURI_SIGNING_PRIVATE_KEY` repository secret,
which GitHub cannot show you again once set. It must therefore also exist
somewhere the maintainer controls and can still read after a laptop dies. That
backup is deliberately not described here — naming its location in a public file
would be the other way to lose it — but it exists, it is offline, and it is
checked when the key is rotated.

If you are forking Karasu: generate your own key
(`npm run tauri signer generate`), because updates signed with this project's
key will not verify against yours and vice versa.

## Supported versions

Karasu ships as a single rolling `latest` prerelease — there's no separate
LTS/stable branch to track yet. The release workflow can also publish tagged
`v*` releases, but that is machinery rather than a channel until the first tag
lands; rolling `latest` remains the only published channel. Please report
issues against the current `latest` release.

## Dependency advisories

Karasu's public dependency alerts include advisories against the **GTK stack**
(`glib`, `gtk`, `atk` and friends). These are worth explaining rather than
leaving to look ignored.

That stack is **not in the published Windows build**. `cargo tree -i glib
--target x86_64-pc-windows-msvc` finds nothing — the crates only enter the graph
for Linux targets, so the NSIS installer never contains this code.

It **does** ship in the Linux AppImage, which is published alongside it. This
section used to say no Linux build existed; that stopped being true when the
AppImage started being released, and the advisories should be read accordingly:
they apply to code Linux users are running, not to something hypothetical.

It is also not fixable here. The versions are pinned upstream by Tauri's Linux
backend — `glib` ← `atk` ← `gtk 0.18` ← `tao`/`tray-icon` ← `tauri` — and
`gtk 0.18` requires `glib ^0.18`, so a newer `glib` is out of range no matter
what this repo does. It resolves when Tauri moves to a newer gtk-rs, and we
pick that up with the next Tauri release.

Advisories against anything else that ships — the Rust crates compiled into
either binary, or the frontend dependencies bundled into both — are treated as
real and acted on.

## Reporting a vulnerability

Please **don't** open a public issue for anything security-sensitive. Email
**contact@kyusetzu.de** instead, with enough detail to reproduce. You should
get a response within a few days.
