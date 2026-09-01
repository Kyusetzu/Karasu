#!/usr/bin/env bash
# Type-check the Windows-only detection code from a machine that is not Windows.
#
# The counterpart to scripts/android-check.ps1, and the same reason: `npm run
# verify` compiles for the host, so every `#[cfg(windows)]` block in the tree
# is invisible to it. CI has a Windows job, but finding a typo there costs a
# round trip of ten minutes.
#
# A whole-crate `cargo check --target x86_64-pc-windows-msvc` is not available
# here and will not become available: rustls pulls `aws-lc-sys`, whose build
# script compiles C against the MSVC headers, and those are not redistributable
# to a Linux box. So this uses the throwaway-crate technique CLAUDE.md already
# documents for the mirror-image problem (Linux-only code on a Windows dev
# machine): copy the module, stub what it reaches for, check that.
#
# Usage: scripts/windows-check.sh
# Requires: rustup target add x86_64-pc-windows-msvc
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if ! rustup target list --installed | grep -qx x86_64-pc-windows-msvc; then
    echo "windows-check: run 'rustup target add x86_64-pc-windows-msvc' first" >&2
    exit 1
fi

# The `windows` feature list is duplicated from src-tauri/Cargo.toml rather
# than parsed out of it. A drift here shows up as a missing-method error naming
# the feature, which is a clearer failure than anything a fragile TOML scrape
# would produce.
mkdir -p "$work/src/detection"
cat > "$work/Cargo.toml" <<'EOF'
[package]
name = "windows-check"
version = "0.0.0"
edition = "2021"

[dependencies]
windows = { version = "0.62", features = [
    "Win32_Foundation",
    "Win32_UI_WindowsAndMessaging",
    "Win32_System_Threading",
    "Win32_System_Com",
    "Win32_Media_Audio",
    "Win32_System_Com_StructuredStorage",
    "Win32_System_Variant",
] }

[workspace]
EOF

cat > "$work/src/lib.rs" <<'EOF'
pub mod detection {
    /// Stands in for the real `detection::process_name`, which is itself Win32
    /// and lives in the module this one is lifted out of. Only the signature
    /// is load-bearing.
    pub(crate) fn process_name(_pid: u32) -> Option<String> {
        None
    }
    pub mod audio;
}
EOF

cp "$repo/src-tauri/src/playback/detection/audio.rs" "$work/src/detection/audio.rs"

echo "windows-check: checking playback/detection/audio.rs against x86_64-pc-windows-msvc"
cd "$work"
cargo check --target x86_64-pc-windows-msvc --quiet
echo "windows-check: ok"
