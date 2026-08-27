<#
.SYNOPSIS
  Renames a freshly-built release APK to carry the full 4-part
  MAJOR.MINOR.PATCH.COMMIT# version and its flavor.

.DESCRIPTION
  The Android counterpart to rename-installer.ps1 and rename-appimage.ps1,
  and deliberately their near twin: same repo-root guard, same COMMIT_NUMBER
  source. The Gradle output is `app-<flavor>-release.apk` with no version at
  all, so unlike the other two this is a wholesale rename rather than a
  substitution: `Karasu_<version>_<flavor>.apk`.

  Deliberately no `.sig` handling and no GITHUB_OUTPUT: Android has no
  updater (updater_available() answers false on mobile, and the manifest
  generator never learns about Android), and the workflow reads names out of
  the collected folder rather than plumbing outputs across jobs — the same
  reasoning rename-appimage.ps1 records.

.PARAMETER Flavor
  Which Gradle flavor's release output to rename: "universal" (every ABI in
  one APK) or "arm64" (the one almost every phone needs).

.PARAMETER Suffix
  A tag's prerelease part, without the leading dash. See rename-installer.ps1,
  whose reasoning this shares.
#>

param(
    [ValidateSet("universal", "arm64", "arm", "x86", "x86_64")]
    [string]$Flavor = "arm64",
    [string]$Suffix = ""
)

$ErrorActionPreference = "Stop"

# Two levels: scripts/release/ -> scripts/ -> repo root.
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $repoRoot "package.json"))) {
    throw "Repo root resolved to '$repoRoot', which holds no package.json -- did this script move?"
}
$apkDir = Join-Path $repoRoot "src-tauri/gen/android/app/build/outputs/apk/$Flavor/release"
$commandsRs = Join-Path $repoRoot "src-tauri/src/commands/update.rs"
$packageJson = Join-Path $repoRoot "package.json"

$apk = Join-Path $apkDir "app-$Flavor-release.apk"
if (-not (Test-Path $apk)) {
    throw "No app-$Flavor-release.apk in $apkDir -- was the $Flavor flavor built in release mode?"
}

$commitMatch = Select-String -Path $commandsRs -Pattern "COMMIT_NUMBER:\s*u32\s*=\s*(\d+);"
if (-not $commitMatch) {
    throw "Could not find COMMIT_NUMBER in $commandsRs"
}
$commitNumber = $commitMatch.Matches[0].Groups[1].Value

$packageVersion = (Get-Content $packageJson -Raw | ConvertFrom-Json).version
$fullVersion = "$packageVersion.$commitNumber"
if ($Suffix) { $fullVersion = "$fullVersion-$Suffix" }

$newName = "Karasu_${fullVersion}_$Flavor.apk"
Rename-Item -Path $apk -NewName $newName

Write-Output (Join-Path $apkDir $newName)
