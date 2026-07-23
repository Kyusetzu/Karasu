<#
.SYNOPSIS
  Renames the freshly-built NSIS installer to include the full 4-part
  MAJOR.MINOR.PATCH.COMMIT# version instead of just the 3-part semver core
  Tauri's bundler uses by default.
#>

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$bundleDir = Join-Path $repoRoot "src-tauri/target/release/bundle/nsis"
$commandsRs = Join-Path $repoRoot "src-tauri/src/commands.rs"
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

$newName = $installer.Name -replace [regex]::Escape($packageVersion), $fullVersion
$newPath = Join-Path $installer.DirectoryName $newName

if ($installer.FullName -ne $newPath) {
    Rename-Item -Path $installer.FullName -NewName $newName
}

Write-Output $newPath
