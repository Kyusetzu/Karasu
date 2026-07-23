# Security Policy

## Scope

Karasu is a local desktop app with **no hosted backend** — it talks directly
to the AniList GraphQL API from your machine. There's no server of ours to
compromise; the realistic attack surface is the app itself, and the AniList
OAuth token it stores in your OS credential store (Windows Credential
Manager, or the Secret Service on Linux).

Things worth reporting: the app mishandling or leaking that token, a way to
execute arbitrary code via a malicious media title/filename/response, or a
flaw in the update mechanism (Karasu verifies every downloaded update
against its own signing key — a way to bypass that would be serious).

## Supported versions

Karasu ships as a single rolling `latest` prerelease — there's no separate
LTS/stable branch to track yet. Please report issues against the current
`latest` release.

## Reporting a vulnerability

Please **don't** open a public issue for anything security-sensitive. Email
**contact@kyusetzu.de** instead, with enough detail to reproduce. You should
get a response within a few days.
