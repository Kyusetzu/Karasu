<# Builds latest.json for the updater; -Tag must name the release the assets live under, or the rolling prune orphans it. #>

param(
    [string]$Tag = "latest",
    [string]$Notes = "Automated build from the latest commit on main."
)

$ErrorActionPreference = "Stop"

# Two levels up is the repo root; check it, or a wrong root surfaces minutes into a release build.
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

$sigPath = "$($installer.FullName).sig"
if (-not (Test-Path $sigPath)) {
    throw "No .sig file found next to $($installer.Name) -- is bundle.createUpdaterArtifacts set and are the TAURI_SIGNING_* env vars present?"
}
$signature = Get-Content -Path $sigPath -Raw

$commitMatch = Select-String -Path $commandsRs -Pattern "COMMIT_NUMBER:\s*u32\s*=\s*(\d+);"
if (-not $commitMatch) {
    throw "Could not find COMMIT_NUMBER in $commandsRs"
}
$commitNumber = $commitMatch.Matches[0].Groups[1].Value
$packageVersion = (Get-Content $packageJson -Raw | ConvertFrom-Json).version
# Semver build metadata, never a fourth dotted segment: the updater's semver parser rejects that and every install dies.
$fullVersion = "$packageVersion+$commitNumber"

# The tag the assets are published under, so a stable manifest never points into the rolling tag the prune step empties.
$downloadUrl = "https://github.com/Kyusetzu/Karasu/releases/download/$Tag/$($installer.Name)"
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
        signature = $signature.Trim()
        url       = $downloadUrl
    }
}

# The Linux leg is optional: a broken AppImage must not hold back a Windows release, and a client reads only its own key.
$linuxDir = Join-Path $repoRoot "linux-artifacts"
$appimage = Get-ChildItem -Path $linuxDir -Filter "*.AppImage" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if ($appimage) {
    $appimageSig = "$($appimage.FullName).sig"
    if (Test-Path $appimageSig) {
        $platforms["linux-x86_64"] = [ordered]@{
            signature = (Get-Content $appimageSig -Raw).Trim()
            url       = "https://github.com/Kyusetzu/Karasu/releases/download/$Tag/$($appimage.Name)"
        }
    }
    else {
        # A warning, not a throw: throwing here failed the Windows publish step and stalled auto-updates for every Windows user.
        Write-Host "::warning::AppImage $($appimage.Name) has no signature; publishing without a Linux updater entry."
    }
}

$manifest = [ordered]@{
    version   = $fullVersion
    notes     = $Notes
    pub_date  = $pubDate
    platforms = $platforms
}

$outPath = Join-Path $repoRoot "latest.json"
$manifest | ConvertTo-Json -Depth 5 | Out-File -FilePath $outPath -Encoding utf8
Write-Output $outPath
