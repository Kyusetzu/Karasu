<# Renames the .deb and the .rpm to the four-part version; a near twin of rename-appimage.ps1 so the names cannot drift. #>

param(
    [string]$Suffix = ""
)

$ErrorActionPreference = "Stop"

# Two levels: scripts/release/ -> scripts/ -> repo root.
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $repoRoot "package.json"))) {
    throw "Repo root resolved to '$repoRoot', which holds no package.json -- did this script move?"
}
$bundleRoot = Join-Path $repoRoot "src-tauri/target/release/bundle"
$commandsRs = Join-Path $repoRoot "src-tauri/src/commands/update.rs"
$packageJson = Join-Path $repoRoot "package.json"

$commitMatch = Select-String -Path $commandsRs -Pattern "COMMIT_NUMBER:\s*u32\s*=\s*(\d+);"
if (-not $commitMatch) {
    throw "Could not find COMMIT_NUMBER in $commandsRs"
}
$commitNumber = $commitMatch.Matches[0].Groups[1].Value

$packageVersion = (Get-Content $packageJson -Raw | ConvertFrom-Json).version
$fullVersion = "$packageVersion.$commitNumber"
if ($Suffix) { $fullVersion = "$fullVersion-$Suffix" }

# The bundler writes `karasu_1.2.3_amd64.deb` and `karasu-1.2.3-1.x86_64.rpm`; both become `Karasu_<full>_<arch>.<ext>`.
$plans = @(
    @{ Dir = "deb"; Filter = "*.deb"; Arch = "amd64" },
    @{ Dir = "rpm"; Filter = "*.rpm"; Arch = "x86_64" }
)
foreach ($plan in $plans) {
    $dir = Join-Path $bundleRoot $plan.Dir
    $file = Get-ChildItem -Path $dir -Filter $plan.Filter -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $file) {
        throw "No $($plan.Filter) found in $dir"
    }
    $newName = "Karasu_$($fullVersion)_$($plan.Arch)$($file.Extension)"
    if ($file.Name -ne $newName) {
        Rename-Item -Path $file.FullName -NewName $newName
    }
    Write-Output (Join-Path $dir $newName)
}
