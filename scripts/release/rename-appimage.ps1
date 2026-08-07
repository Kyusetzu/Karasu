<#
.SYNOPSIS
  Renames the freshly-built AppImage to include the full 4-part
  MAJOR.MINOR.PATCH.COMMIT# version instead of just the 3-part semver core
  Tauri's bundler uses by default.

.DESCRIPTION
  The Linux counterpart to rename-installer.ps1, and deliberately its near
  twin: same repo-root guard, same COMMIT_NUMBER source, same substitution. The
  two producing differently-shaped names is exactly the kind of drift that only
  shows up when a release is half-published.

  PowerShell on a Linux runner is not a mistake — pwsh is preinstalled on
  GitHub's Ubuntu images, and keeping scripts/release/ one toolchain is worth
  more than avoiding it.
#>

$ErrorActionPreference = "Stop"

# Two levels: scripts/release/ -> scripts/ -> repo root.
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $repoRoot "package.json"))) {
    throw "Repo root resolved to '$repoRoot', which holds no package.json -- did this script move?"
}
$bundleDir = Join-Path $repoRoot "src-tauri/target/release/bundle/appimage"
$commandsRs = Join-Path $repoRoot "src-tauri/src/commands/update.rs"
$packageJson = Join-Path $repoRoot "package.json"

$appimage = Get-ChildItem -Path $bundleDir -Filter "*.AppImage" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $appimage) {
    throw "No .AppImage found in $bundleDir"
}

$commitMatch = Select-String -Path $commandsRs -Pattern "COMMIT_NUMBER:\s*u32\s*=\s*(\d+);"
if (-not $commitMatch) {
    throw "Could not find COMMIT_NUMBER in $commandsRs"
}
$commitNumber = $commitMatch.Matches[0].Groups[1].Value

$packageVersion = (Get-Content $packageJson -Raw | ConvertFrom-Json).version
$fullVersion = "$packageVersion.$commitNumber"

$newName = $appimage.Name -replace [regex]::Escape($packageVersion), $fullVersion

if ($appimage.Name -ne $newName) {
    # Every sibling that starts with the original name, not just "<name>.sig":
    # the updater artifact's exact shape depends on createUpdaterArtifacts, and
    # a prefix match catches `.sig` and a `.tar.gz` pair alike rather than
    # silently leaving one behind under the old version.
    $siblings = Get-ChildItem -Path $bundleDir -Filter "$($appimage.Name)*" |
        Where-Object { $_.Name -ne $appimage.Name }

    Rename-Item -Path $appimage.FullName -NewName $newName
    foreach ($s in $siblings) {
        $suffix = $s.Name.Substring($appimage.Name.Length)
        Rename-Item -Path $s.FullName -NewName "$newName$suffix"
    }
}

# Deliberately no GITHUB_OUTPUT here, unlike rename-installer.ps1. This used to
# write one under a comment claiming the workflow needed it, but the step that
# runs this script has no `id:`, so no `steps.<id>.outputs.appimage` could ever
# have referenced it — and the prune step reads the name out of the downloaded
# folder instead, precisely to avoid plumbing an output across jobs. A dead
# output is bad enough; one with a comment asserting it is load-bearing invites
# someone to wire it up to an expression that silently resolves to "".
Write-Output (Join-Path $bundleDir $newName)
