#!/usr/bin/env bash
# Type-checks the Windows-only audio module from Linux in a throwaway crate; aws-lc-sys rules out a whole-crate check.
#
#   scripts/windows-check.sh                    first: rustup target add x86_64-pc-windows-msvc
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if ! rustup target list --installed | grep -qx x86_64-pc-windows-msvc; then
    echo "windows-check: run 'rustup target add x86_64-pc-windows-msvc' first" >&2
    exit 1
fi

# The feature list is copied from src-tauri/Cargo.toml; a drift shows as a missing-method error naming the feature.
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
