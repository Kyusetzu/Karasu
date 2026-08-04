<#
.SYNOPSIS
  Builds latest.json, the manifest the in-app updater (tauri-plugin-updater)
  fetches to learn about new releases. Must run after rename-installer.ps1,
  since it needs the installer's final (4-part-versioned) filename.
#>

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
# The commit number is attached as semver *build metadata* ("0.23.2+90"), not as
# a fourth dotted segment. tauri-plugin-updater parses this field with
# semver::Version::from_str, which rejects "0.23.2.90" outright -- the manifest
# then fails to deserialize and every install dies with
# "unexpected character '.' after patch version number".
# Build metadata is ignored by semver precedence, so update.rs pairs this with
# an explicit version_comparator to keep commit-only bumps detectable.
$fullVersion = "$packageVersion+$commitNumber"

# Fixed rolling-tag download URL -- matches release.yml's `tag_name: latest`.
$downloadUrl = "https://github.com/Kyusetzu/Karasu/releases/download/latest/$($installer.Name)"
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$manifest = [ordered]@{
    version   = $fullVersion
    notes     = "Automated build from the latest commit on main."
    pub_date  = $pubDate
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $signature.Trim()
            url       = $downloadUrl
        }
    }
}

$outPath = Join-Path $repoRoot "latest.json"
$manifest | ConvertTo-Json -Depth 5 | Out-File -FilePath $outPath -Encoding utf8
Write-Output $outPath
