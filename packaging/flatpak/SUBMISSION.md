# Flathub submission

What is here and what the maintainer still has to do by hand. The repo side is
complete: `dev.kyu.karasu.yml` is the manifest, `dev.kyu.karasu.metainfo.xml`
the AppStream data, and `scripts/release/flatpak-manifest.ps1 -Tag vX.Y.Z`
fills both from a tagged release (the `.deb`'s URL and sha256 out of its
`SHA256SUMS.txt`, the release date). The `Flatpak` workflow runs that script,
validates the metainfo with `appstreamcli --pedantic` and builds the bundle on
a GNOME 50 builder — run it once against the tag before opening the request,
and again after every change to either file.

## The one-time request

1. Fork <https://github.com/flathub/flathub>, branch from `new-pr`, add the two
   filled files from `packaging/flatpak/out/` at the repository root.
2. Open the pull request against `new-pr`. The template asks for the app id
   (`dev.kyu.karasu`), that the app is not already on Flathub, and that the
   submitter is the developer — which is the case.
3. Review answers what the manifest cannot: the reviewers may ask for the
   `--talk-name` lines to be justified. The reasons are in the manifest's
   comments (tray = StatusNotifier, MPRIS = the media-session pass, secrets =
   the token, the settings portal = the accent), and each is a real feature.

## What changes under Flatpak, and what to say if asked

- **Autostart** — `tauri-plugin-autostart` writes `~/.config/autostart`, which
  inside the sandbox is app-private, so the toggle in Settings does nothing on
  Flathub. The right way is the Background portal's `RequestBackground`,
  which the plugin does not use; until it does, the Settings pane should hide
  the toggle when `FLATPAK_ID` is set (an item for the session that lands
  Flathub, not before).
- **The local library** — the folder picker goes through the file-chooser
  portal and hands back a `/run/user/…/doc/` path that is valid for that
  session; the scanner re-reads it on the next start, which needs the grant
  persisted. `--filesystem=xdg-videos:ro` covers the usual folder outright.
- **The updater** — must stay off: Flathub updates the app, and the in-app
  updater would try to replace a read-only `/app/bin/karasu`. `can_install`
  in `commands/update.rs` already refuses on Linux outside an AppImage, so a
  Flatpak sees the notice and no install button, which is the right shape.
- **The OAuth callback** listens on localhost; `--share=network` is what makes
  it reachable from the browser the portal opens.

## Updating a release

Run `flatpak-manifest.ps1` for the new tag and open a pull request against
`flathub/dev.kyu.karasu` with the two regenerated files; the Flathub
buildbot builds and publishes on merge. `flatpak-external-data-checker` can be
enabled in that repository later so the bot opens the update itself.
