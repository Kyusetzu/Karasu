<# Fills the fdroiddata recipe from one tag: version name and code, the commit, and the release signing key if given. #>

param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [string]$SigningKey = "",
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

# Two levels: scripts/release/ -> scripts/ -> repo root.
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $OutDir) { $OutDir = Join-Path $repoRoot "packaging/fdroid/out" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# The four-part version and the code come from the tag's own tree, the same lines build.gradle.kts reads at build time.
$commandsRs = git -C $repoRoot show "${Tag}:src-tauri/src/commands/update.rs"
if ($LASTEXITCODE -ne 0) { throw "Tag $Tag is not in this clone; fetch it first." }
$commitMatch = [regex]::Match(($commandsRs -join "`n"), "COMMIT_NUMBER:\s*u32\s*=\s*(\d+);")
if (-not $commitMatch.Success) { throw "No COMMIT_NUMBER in $Tag's update.rs" }
$commitNumber = [int]$commitMatch.Groups[1].Value
$core = ($Tag -replace "^v", "")
$versionName = "$core.$commitNumber"
$versionCode = 1000000 + $commitNumber

$recipe = Get-Content (Join-Path $repoRoot "packaging/fdroid/dev.kyu.karasu.yml") -Raw
$recipe = $recipe.Replace("VERSION_TO_FILL", $versionName).Replace("VERSIONCODE_TO_FILL", "$versionCode").Replace("TAG_TO_FILL", $Tag)
if ($SigningKey) { $recipe = $recipe.Replace("SIGNING_KEY_TO_FILL", $SigningKey.ToLower()) }
[IO.File]::WriteAllText((Join-Path $OutDir "dev.kyu.karasu.yml"), $recipe, [Text.UTF8Encoding]::new($false))

Write-Output "fdroid-recipe: $Tag -> $versionName ($versionCode) in $OutDir$(if (-not $SigningKey) { '; signing key left to fill (apksigner verify --print-certs on a release APK)' })"
