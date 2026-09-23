<# Takes the libwayland-client linuxdeploy bundles back out of the AppImage, because newer Mesa cannot use it. #>

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

# Two levels: scripts/release/ -> scripts/ -> repo root.
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $repoRoot "package.json"))) {
    throw "Repo root resolved to '$repoRoot', which holds no package.json -- did this script move?"
}
$bundleDir = Join-Path $repoRoot "src-tauri/target/release/bundle/appimage"

$appimage = Get-ChildItem -Path $bundleDir -Filter "*.AppImage" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $appimage) {
    throw "No .AppImage found in $bundleDir"
}

# Only the client: every GTK host has its own, while libwayland-server, also bundled, is absent from some hosts.
$drop = @("libwayland-client.so*")

# Pinned by digest; the tool is only a packer, the runtime comes from Tauri's own file below.
$toolUrl = "https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage"
$toolSha256 = "ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0"

$work = Join-Path ([System.IO.Path]::GetTempPath()) "karasu-slim-appimage"
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $work | Out-Null
Push-Location $work
try {
    & $appimage.FullName --appimage-extract | Out-Null

    $lib = Join-Path $work "squashfs-root/usr/lib"
    $found = @(Get-ChildItem -Path $lib -Recurse -Include $drop)
    if ($found.Count -eq 0) {
        throw "libwayland-client is not in the AppImage; linuxdeploy changed, re-check tauri-apps/tauri#15976"
    }
    foreach ($f in $found) {
        Write-Host "removing $($f.Name)"
        Remove-Item -Force $f.FullName
    }

    # The ELF runtime is everything before the squashfs, so the repacked file boots exactly as Tauri's did.
    $offset = [int](& $appimage.FullName --appimage-offset)
    $runtime = Join-Path $work "runtime"
    $head = [byte[]]::new($offset)
    $in = [System.IO.File]::OpenRead($appimage.FullName)
    try {
        $read = 0
        while ($read -lt $offset) {
            $n = $in.Read($head, $read, $offset - $read)
            if ($n -le 0) { throw "The AppImage ended before its runtime did" }
            $read += $n
        }
    } finally {
        $in.Dispose()
    }
    [System.IO.File]::WriteAllBytes($runtime, $head)

    $tool = Join-Path $work "appimagetool"
    Invoke-WebRequest -Uri $toolUrl -OutFile $tool
    $actual = (Get-FileHash -Algorithm SHA256 $tool).Hash.ToLowerInvariant()
    if ($actual -ne $toolSha256) {
        throw "appimagetool digest is $actual, expected $toolSha256"
    }
    chmod +x $tool

    # The runner has no FUSE, so the packer unpacks itself instead of mounting.
    $env:APPIMAGE_EXTRACT_AND_RUN = "1"
    $env:ARCH = "x86_64"
    $slim = Join-Path $work $appimage.Name
    & $tool --no-appstream --runtime-file $runtime (Join-Path $work "squashfs-root") $slim
    Move-Item -Force $slim $appimage.FullName
    chmod +x $appimage.FullName

    # Proves the repacked file opens and the library stayed out.
    Remove-Item -Recurse -Force (Join-Path $work "squashfs-root")
    & $appimage.FullName --appimage-extract | Out-Null
    $left = @(Get-ChildItem -Path $lib -Recurse -Include $drop)
    if ($left.Count -ne 0) {
        throw "The repacked AppImage still carries: $($left.Name -join ', ')"
    }
} finally {
    Pop-Location
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

# The updater verifies the file's bytes, so a signature over the original AppImage would refuse every update.
$sig = "$($appimage.FullName).sig"
if (Test-Path $sig) {
    if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
        throw "The AppImage was signed but TAURI_SIGNING_PRIVATE_KEY is not set here; cannot re-sign it"
    }
    Remove-Item -Force $sig
    Push-Location $repoRoot
    try {
        npx tauri signer sign $appimage.FullName | Out-Host
    } finally {
        Pop-Location
    }
    if (-not (Test-Path $sig)) {
        throw "tauri signer wrote no $sig"
    }
}

Write-Output "slimmed $($appimage.Name): $($found.Count) library file(s) removed$(if (Test-Path $sig) { ', re-signed' })"
