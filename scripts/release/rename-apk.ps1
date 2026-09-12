<# Renames the Gradle APK to `Karasu_<version>_<flavor>.apk`; no .sig and no GITHUB_OUTPUT, as Android has no updater. #>

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
