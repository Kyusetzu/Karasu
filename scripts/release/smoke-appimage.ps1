<# Starts the built AppImage on other distributions under Xvfb and fails when it does not stay up. #>

param(
    [string[]]$Images = @("registry.fedoraproject.org/fedora:44", "mirror.gcr.io/library/ubuntu:26.04"),
    [int]$Seconds = 25,
    [string[]]$DockerArgs = @()
)

$ErrorActionPreference = "Stop"

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

# Exit 100 is the install failing, which says nothing about the AppImage; every other failure is the app's.
$payload = @'
set -u
for i in 1 2 3; do sh -c "$INSTALL" > /tmp/install.log 2>&1 && break; [ "$i" = 3 ] && { tail -20 /tmp/install.log; exit 100; }; sleep 10; done
cd /tmp && /appimage/"$APPIMAGE_NAME" --appimage-extract > /dev/null || exit 1
missing=0
for f in $(find squashfs-root/usr/bin squashfs-root/usr/lib -type f); do
  [ "$(head -c 4 "$f" | od -An -c | tr -d ' ')" = '177ELF' ] || continue
  out=$(LD_LIBRARY_PATH=squashfs-root/usr/lib ldd "$f" 2>/dev/null | grep 'not found') && { echo "$f: $out"; missing=1; }
done
[ "$missing" = 0 ] || { echo "SMOKE FAIL: a bundled library needs something neither the bundle nor this host has"; exit 1; }
export XDG_RUNTIME_DIR=/tmp/xdg HOME=/tmp/home DISPLAY=:99 GTK_IM_MODULE=wayland
mkdir -p -m 700 "$XDG_RUNTIME_DIR" "$HOME"
Xvfb :99 -screen 0 1600x1000x24 > /tmp/xvfb.log 2>&1 &
sleep 2
cat > /tmp/probe.sh <<'EOF'
/tmp/squashfs-root/AppRun > /tmp/app.log 2>&1 &
pid=$!
for s in $(seq "$SMOKE_SECONDS"); do sleep 1; kill -0 "$pid" 2> /dev/null || break; done
if kill -0 "$pid" 2> /dev/null; then echo "main=alive"; else wait "$pid"; echo "main=exited rc=$?"; fi
echo "webprocess=$(pgrep -c '^WebKitWebProc')"
EOF
dbus-run-session -- bash /tmp/probe.sh > /tmp/probe.log 2> /dev/null
cat /tmp/probe.log
if grep -q '^main=alive' /tmp/probe.log && ! grep -q '^webprocess=0' /tmp/probe.log \
  && ! grep -E -q 'EGL_BAD_PARAMETER|cannot open shared object|undefined symbol|panicked' /tmp/app.log; then
  echo "SMOKE OK"; exit 0
fi
echo "SMOKE FAIL"; tail -40 /tmp/app.log; exit 1
'@

$failed = @()
$tested = 0
foreach ($image in $Images) {
    $install = if ($image -match "fedora") {
        "dnf -y -q --disablerepo=fedora-cisco-openh264 install --setopt=install_weak_deps=False " +
        "xorg-x11-server-Xvfb mesa-dri-drivers mesa-libEGL mesa-libGL libglvnd-gles gtk3 dbus-daemon procps-ng findutils"
    } else {
        "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq --no-install-recommends " +
        "xvfb dbus libgtk-3-0t64 libegl1 libgl1 libgbm1 libegl-mesa0 libgl1-mesa-dri procps ca-certificates"
    }
    Write-Host "== $image"
    $dockerRun = @("run", "--rm") + $DockerArgs + @(
        "-v", "$($bundleDir):/appimage:ro",
        "-e", "APPIMAGE_NAME=$($appimage.Name)", "-e", "SMOKE_SECONDS=$Seconds", "-e", "INSTALL=$install",
        $image, "bash", "-c", $payload
    )
    # An image already present is used as it is; otherwise a failed pull is retried once and then only warned about.
    & docker image inspect $image *> $null
    if ($LASTEXITCODE -ne 0) {
        & docker pull -q $image | Out-Null
        if ($LASTEXITCODE -ne 0) { Start-Sleep 15; & docker pull -q $image | Out-Null }
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "::warning::could not pull $image; the AppImage was not smoke-tested there"
        continue
    }
    & docker @dockerRun
    switch ($LASTEXITCODE) {
        0 { $tested++ }
        100 { Write-Host "::warning::the packages did not install on $image; the AppImage was not smoke-tested there" }
        default { $failed += $image }
    }
}

if ($failed.Count -gt 0) {
    throw "The AppImage did not stay up on: $($failed -join ', ')"
}
Write-Output "smoke-tested $($appimage.Name) on $tested of $($Images.Count) image(s) for $Seconds s"
