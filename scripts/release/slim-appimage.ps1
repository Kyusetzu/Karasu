<# Takes the libraries the host's Mesa also loads back out of the AppImage, and makes the GTK hook's X11 overridable. #>

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

# Bundled, loaded by the host's Mesa or its X11/Wayland siblings, and present on every host CLAUDE.md names.
$drop = @(
    "libwayland-client.so.0*", "libwayland-cursor.so.0*", "libwayland-egl.so.1*", "libxkbcommon.so.0*",
    "libxcb-randr.so.0*", "libxcb-render.so.0*", "libxcb-shm.so.0*", "libXau.so.6*", "libXdmcp.so.6*",
    "libXext.so.6*", "libzstd.so.1*", "libelf.so.1*", "libffi.so.8*", "liblzma.so.5*"
)

# The im-wayland module bundled with GTK dereferences a null display when GDK runs on X11.
$hookName = "linuxdeploy-plugin-gtk.sh"
$backendLine = 'export GDK_BACKEND="${GDK_BACKEND:-x11}"'
$imLine = '[ "${GDK_BACKEND%%,*}" = wayland ] || case "$GTK_IM_MODULE" in wayland*) unset GTK_IM_MODULE;; esac'

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
    # Every pattern must match, so a linuxdeploy that stops bundling one fails here instead of leaving a stale list.
    $found = foreach ($pattern in $drop) {
        $hits = @(Get-ChildItem -Path $lib -Recurse -Filter $pattern)
        if ($hits.Count -eq 0) {
            throw "$pattern is not in the AppImage; linuxdeploy changed, re-check the AppImage notes in CLAUDE.md"
        }
        $hits
    }
    foreach ($f in $found) {
        Write-Host "removing $($f.Name)"
        Remove-Item -Force $f.FullName
    }

    $hook = Join-Path $work "squashfs-root/apprun-hooks/$hookName"
    if (-not (Test-Path $hook)) {
        throw "The AppImage carries no $hookName; the GTK plugin changed"
    }
    $text = [System.IO.File]::ReadAllText($hook)
    $forced = [regex]::Matches($text, '(?m)^export GDK_BACKEND=x11\b[^\n]*$')
    if ($forced.Count -ne 1) {
        throw "$hookName forces GDK_BACKEND=x11 $($forced.Count) times, expected once; the GTK plugin changed"
    }
    # Spliced rather than -replace, because ${...} is a substitution token in a .NET replacement string.
    $text = $text.Remove($forced[0].Index, $forced[0].Length).Insert($forced[0].Index, "$backendLine`n$imLine")
    [System.IO.File]::WriteAllText($hook, $text, [System.Text.UTF8Encoding]::new($false))

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

    # Proves the repacked file opens, the libraries stayed out and the hook carries both lines once.
    Remove-Item -Recurse -Force (Join-Path $work "squashfs-root")
    & $appimage.FullName --appimage-extract | Out-Null
    $left = @(foreach ($pattern in $drop) { Get-ChildItem -Path $lib -Recurse -Filter $pattern })
    if ($left.Count -ne 0) {
        throw "The repacked AppImage still carries: $($left.Name -join ', ')"
    }
    $repacked = [System.IO.File]::ReadAllText($hook)
    foreach ($line in @($backendLine, $imLine)) {
        $count = ([regex]::Matches($repacked, "(?m)^$([regex]::Escape($line))$")).Count
        if ($count -ne 1) {
            throw "The repacked $hookName carries '$line' $count times, expected once"
        }
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

Write-Output "slimmed $($appimage.Name): $(@($found).Count) library file(s) removed, GDK_BACKEND overridable$(if (Test-Path $sig) { ', re-signed' })"
