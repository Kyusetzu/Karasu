# Security Policy

## Scope

Karasu is a local desktop app with **no hosted backend** — it talks directly
to the AniList GraphQL API from your machine. There's no server of ours to
compromise; the realistic attack surface is the app itself and the secrets it
holds in your OS credential store (Windows Credential Manager, or the Secret
Service on Linux):

- your **AniList OAuth token**, and
- your **Jellyfin access token**, if you connected a Jellyfin server.

Neither is ever handed to the WebView — the UI only ever learns *whether* one
is stored.

The credential store stays the only place either token is persisted. The
Jellyfin one is additionally held in memory by the Rust process while the app
runs, so that the detection poll does not reach for the credential store every
five seconds; it is dropped on exit and cleared on sign-out.

Signing in to Jellyfin sends your username and password to your own server
once, in exchange for that access token (`/Users/AuthenticateByName` — Jellyfin
has no OAuth, so this is how every third-party client authenticates). **The
password is never written to disk and never kept in memory beyond the request.**
An ordinary account is enough; Karasu deliberately does not use an admin API
key, because an API key makes Jellyfin report every session on the server
rather than only your own.

Karasu contacts AniList, GitHub (update checks and downloads) and a localhost
callback during login. A Jellyfin server you configure yourself is contacted
too; that is your machine, not ours, and the "no hosted backend" guarantee is
unaffected.

Things worth reporting: the app mishandling or leaking either secret, a way to
execute arbitrary code via a malicious media title/filename/response, or a
flaw in the update mechanism (Karasu verifies every downloaded update
against its own signing key — a way to bypass that would be serious).

## Supported versions

Karasu ships as a single rolling `latest` prerelease — there's no separate
LTS/stable branch to track yet. Please report issues against the current
`latest` release.

## Dependency advisories

Karasu's public dependency alerts include advisories against the **GTK stack**
(`glib`, `gtk`, `atk` and friends). These are worth explaining rather than
leaving to look ignored.

That stack is **Linux-only groundwork and is not in the published Windows
build**. `cargo tree -i glib --target x86_64-pc-windows-msvc` finds nothing —
the crates only enter the graph for Linux targets, and no Linux build is
published (see the platforms note in the README). The shipped installer never
contains this code.

It is also not fixable here. The versions are pinned upstream by Tauri's Linux
backend — `glib` ← `atk` ← `gtk 0.18` ← `tao`/`tray-icon` ← `tauri` — and
`gtk 0.18` requires `glib ^0.18`, so a newer `glib` is out of range no matter
what this repo does. It resolves when Tauri moves to a newer gtk-rs, and we
pick that up with the next Tauri release.

Advisories against anything that *does* ship — the Rust crates compiled into
the Windows binary, or the frontend dependencies bundled into it — are treated
as real and acted on.

## Reporting a vulnerability

Please **don't** open a public issue for anything security-sensitive. Email
**contact@kyusetzu.de** instead, with enough detail to reproduce. You should
get a response within a few days.
