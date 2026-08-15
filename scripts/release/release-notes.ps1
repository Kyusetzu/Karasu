<#
.SYNOPSIS
  Writes the body of a GitHub release to a file, for `body_path:`.

  Two shapes. A rolling build gets the same paragraph it has always had. A
  tagged release gets its own section sliced out of CHANGELOG.md, followed by
  the same download-and-verify boilerplate — the part that tells Windows users
  why SmartScreen warns and Linux users which library the AppImage does not
  bundle, which is true of every release regardless of what changed in it.

  A FILE, not a workflow expression. `${{ }}` inside a YAML block scalar is
  textual substitution before anything parses it, and CHANGELOG markdown is
  full of backticks, dollars and quotes — in a job that holds the signing key.
  release.yml's prune step already documents that class of bug for a single
  filename; this is strictly worse input.

.PARAMETER Version
  The semver core the CHANGELOG heading is expected to carry ("1.0.0"). Empty
  for a rolling build.

.PARAMETER Sha
  The commit, quoted in the rolling body.

.PARAMETER VirusTotal
  The scan link, or empty.

.PARAMETER OutFile
  Where to write. Defaults to notes.md in the working directory.
#>

param(
    [string]$Version = "",
    [string]$Sha = "",
    [string]$VirusTotal = "",
    [string]$OutFile = "notes.md"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $repoRoot "package.json"))) {
    throw "Repo root resolved to '$repoRoot', which holds no package.json -- did this script move?"
}

# Every release says this, because it is true of every release.
$boilerplate = @"
**Windows** -- the ``.exe`` installer. It is **unsigned**, so SmartScreen may
warn on first run. Verify the download against ``SHA256SUMS.txt`` if you want to
confirm it wasn't tampered with in transit.

**Linux** -- the ``.AppImage``, x86_64. ``chmod +x`` it and run it; it works on
Ubuntu 22.04+, Debian 12+ and Arch. It needs **webkit2gtk-4.1** present on the
system (``libwebkit2gtk-4.1-0`` on Ubuntu/Debian, ``webkit2gtk-4.1`` on Arch) --
that one is not bundled. For a tray icon you also need a StatusNotifier host; on
GNOME that means the AppIndicator extension. Without one Karasu still runs and
closing the window quits instead of hiding.

Karasu's built-in updater (About page, or automatic daily checks) verifies
updates against its own signing key regardless -- see ``latest.json`` for the
update manifest.
"@

if ([string]::IsNullOrWhiteSpace($Version)) {
    $head = "Automated build from the latest commit on ``main`` ($Sha)."
}
else {
    $changelog = Join-Path $repoRoot "CHANGELOG.md"
    if (-not (Test-Path $changelog)) {
        throw "No CHANGELOG.md at $changelog"
    }
    # Slice `## <version>` up to the next `## `. The heading may carry a trailing
    # ` - <date>' or similar; anything after the version is ignored.
    $lines = Get-Content $changelog
    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^##\s+v?$([regex]::Escape($Version))(\s|$)") {
            $start = $i + 1
            break
        }
    }
    if ($start -lt 0) {
        throw "CHANGELOG.md has no '## $Version' section. Rename '## Unreleased' to it before tagging -- a release published without one carries an empty body and nothing complains."
    }
    $end = $lines.Count
    for ($i = $start; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^##\s") { $end = $i; break }
    }
    $section = ($lines[$start..($end - 1)] -join "`n").Trim()
    if ([string]::IsNullOrWhiteSpace($section)) {
        throw "The '## $Version' section in CHANGELOG.md is empty."
    }
    $head = $section
}

$body = $head
if (-not [string]::IsNullOrWhiteSpace($VirusTotal)) {
    $boilerplate = "$boilerplate`n`nVirusTotal scan: $VirusTotal"
}
$body = "$body`n`n---`n`n$boilerplate`n"

# LF and no BOM, for the same reason SHA256SUMS.txt is written this way: this
# runs on windows-latest and the output is read by something that is not
# Windows.
[IO.File]::WriteAllText(
    (Join-Path $PWD $OutFile),
    ($body -replace "`r`n", "`n"),
    [Text.UTF8Encoding]::new($false)
)
Write-Output (Join-Path $PWD $OutFile)
