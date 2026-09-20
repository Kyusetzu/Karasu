<# Fills the Flatpak manifest and metainfo from one release: the .deb url and sha256 from SHA256SUMS.txt, the tag date. #>

param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

# Two levels: scripts/release/ -> scripts/ -> repo root.
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$src = Join-Path $repoRoot "packaging/flatpak"
if (-not $OutDir) { $OutDir = Join-Path $repoRoot "packaging/flatpak/out" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$base = "https://github.com/Kyusetzu/Karasu/releases/download/$Tag"
$sums = (Invoke-WebRequest -UseBasicParsing "$base/SHA256SUMS.txt").Content -split "`n"
$debLine = $sums | Where-Object { $_ -match "_amd64\.deb$" } | Select-Object -First 1
if (-not $debLine) {
    throw "Release $Tag lists no _amd64.deb in SHA256SUMS.txt; the packages joined the release with 1.18.1."
}
$sha, $name = ($debLine.Trim() -split "\s+", 2)
$version = ($Tag -replace "^v", "")
# The tag's own date rather than today's, so a manifest regenerated later still says when the release was.
$published = (gh release view $Tag --json publishedAt --jq .publishedAt)
if ($LASTEXITCODE -ne 0) { throw "gh could not read release $Tag" }
$date = ([DateTime]$published).ToString("yyyy-MM-dd")

$manifest = Get-Content (Join-Path $src "dev.kyu.karasu.yml") -Raw
$manifest = $manifest.Replace("URL_TO_FILL", "$base/$name").Replace("SHA256_TO_FILL", $sha)
[IO.File]::WriteAllText((Join-Path $OutDir "dev.kyu.karasu.yml"), $manifest, [Text.UTF8Encoding]::new($false))

$meta = Get-Content (Join-Path $src "dev.kyu.karasu.metainfo.xml") -Raw
$meta = $meta.Replace("RELEASE_TO_FILL", $version).Replace("DATE_TO_FILL", $date).Replace("TAG_TO_FILL", $Tag)
[IO.File]::WriteAllText((Join-Path $OutDir "dev.kyu.karasu.metainfo.xml"), $meta, [Text.UTF8Encoding]::new($false))

Write-Output "flatpak-manifest: $Tag -> $OutDir ($name, $sha)"
