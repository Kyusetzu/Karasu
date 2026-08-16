<#
.SYNOPSIS
  Renames the freshly-built NSIS installer to include the full 4-part
  MAJOR.MINOR.PATCH.COMMIT# version instead of just the 3-part semver core
  Tauri's bundler uses by default.

.PARAMETER Suffix
  A tag's prerelease part, without the leading dash — "rc1" for `v1.0.0-rc1`.

  The bundler names the installer from `package.json`, which carries only the
  semver core, so a release-candidate tag and the final release produced
  byte-identically *named* installers. Someone who downloaded the rc could not
  tell it apart from the real thing afterwards, and the rolling prune keeps
  assets by name. The suffix is on the filename only: `latest.json`'s `version`
  stays clean semver plus build metadata, so nothing has to teach
  `version_parts` about prerelease markers.
#>

param(
    [string]$Suffix = ""
)

$ErrorActionPreference = "Stop"

# Two levels: scripts/release/ -> scripts/ -> repo root. Nothing here runs
# outside CI, so a wrong root surfaces minutes into a release build; check it
# rather than letting Get-ChildItem report a path nobody recognises.
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $repoRoot "package.json"))) {
    throw "Repo root resolved to '$repoRoot', which holds no package.json -- did this script move?"
}
$bundleDir = Join-Path $repoRoot "src-tauri/target/release/bundle/nsis"
$commandsRs = Join-Path $repoRoot "src-tauri/src/commands/update.rs"
$packageJson = Join-Path $repoRoot "package.json"

$installer = Get-ChildItem -Path $bundleDir -Filter "*.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $installer) {
    throw "No installer .exe found in $bundleDir"
}

$commitMatch = Select-String -Path $commandsRs -Pattern "COMMIT_NUMBER:\s*u32\s*=\s*(\d+);"
if (-not $commitMatch) {
    throw "Could not find COMMIT_NUMBER in $commandsRs"
}
$commitNumber = $commitMatch.Matches[0].Groups[1].Value

$packageVersion = (Get-Content $packageJson -Raw | ConvertFrom-Json).version
$fullVersion = "$packageVersion.$commitNumber"
if ($Suffix) { $fullVersion = "$fullVersion-$Suffix" }

$newName = $installer.Name -replace [regex]::Escape($packageVersion), $fullVersion
$newPath = Join-Path $installer.DirectoryName $newName

if ($installer.FullName -ne $newPath) {
    Rename-Item -Path $installer.FullName -NewName $newName

    # createUpdaterArtifacts produces a sibling `<installer>.sig` -- keep it
    # matched to the renamed installer if present.
    $sigPath = "$($installer.FullName).sig"
    if (Test-Path $sigPath) {
        Rename-Item -Path $sigPath -NewName "$newName.sig"
    }
}

# The release workflow needs the final name to know which asset to keep when
# it prunes the rolling release.
if ($env:GITHUB_OUTPUT) {
    "installer=$newName" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
}

Write-Output $newPath
