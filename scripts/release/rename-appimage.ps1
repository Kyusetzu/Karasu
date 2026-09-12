<# Renames the AppImage to the four-part version; a near twin of rename-installer.ps1 so the two names cannot drift. #>

param(
    [string]$Suffix = ""
)

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
if ($Suffix) { $fullVersion = "$fullVersion-$Suffix" }

$newName = $appimage.Name -replace [regex]::Escape($packageVersion), $fullVersion

if ($appimage.Name -ne $newName) {
    # Every sibling with the original name as prefix, so `.sig` and a `.tar.gz` pair alike follow the rename.
    $siblings = Get-ChildItem -Path $bundleDir -Filter "$($appimage.Name)*" |
        Where-Object { $_.Name -ne $appimage.Name }

    Rename-Item -Path $appimage.FullName -NewName $newName
    foreach ($s in $siblings) {
        # `$tail`, not `$suffix`: names are case-insensitive, so a local `$suffix` would clobber the `$Suffix` parameter.
        $tail = $s.Name.Substring($appimage.Name.Length)
        Rename-Item -Path $s.FullName -NewName "$newName$tail"
    }
}

# No GITHUB_OUTPUT on purpose: the prune step reads the name from the downloaded folder, not from an output across jobs.
Write-Output (Join-Path $bundleDir $newName)
